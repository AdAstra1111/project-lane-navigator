import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { PackageCheck, Plus, Trash2, Check, X, ChevronDown, MapPin, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  useProjectDeliverables,
  calculateDeliveryReadiness,
  DELIVERABLE_TYPES,
  DELIVERABLE_STATUSES,
} from '@/hooks/useDeliverables';

interface Props {
  projectId: string;
}

export function DeliveryIntelligencePanel({ projectId }: Props) {
  const { deliverables, addDeliverable, updateDeliverable, deleteDeliverable } = useProjectDeliverables(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ item_name: '', territory: '', buyer_name: '', deliverable_type: 'technical' });
  const [territoryFilter, setTerritoryFilter] = useState<string>('all');

  const readiness = useMemo(() => calculateDeliveryReadiness(deliverables), [deliverables]);

  const territories = useMemo(() => {
    const set = new Set(deliverables.map(d => d.territory || 'Unassigned'));
    return Array.from(set).sort();
  }, [deliverables]);

  const filtered = territoryFilter === 'all'
    ? deliverables
    : deliverables.filter(d => (d.territory || 'Unassigned') === territoryFilter);

  const handleAdd = () => {
    if (!form.item_name.trim()) return;
    addDeliverable.mutate(form);
    setForm({ item_name: '', territory: '', buyer_name: '', deliverable_type: 'technical' });
    setAdding(false);
  };

  const handleStatusChange = (id: string, status: string) => {
    updateDeliverable.mutate({ id, status });
  };

  const scoreColor = readiness.score >= 75 ? 'text-emerald-400' : readiness.score >= 40 ? 'text-amber-400' : 'text-red-400';
  const progressColor = readiness.score >= 75 ? 'bg-emerald-500' : readiness.score >= 40 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="space-y-4"
    >
      {/* Score header */}
      {deliverables.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <PackageCheck className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Delivery Readiness</span>
            </div>
            <span className={cn('text-lg font-bold font-display', scoreColor)}>{readiness.score}%</span>
          </div>
          <Progress value={readiness.score} className="h-2 mb-2" />
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>{readiness.completed}/{readiness.total} completed</span>
            {readiness.blocked > 0 && (
              <span className="text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> {readiness.blocked} blocked
              </span>
            )}
          </div>

          {/* Territory breakdown */}
          {Object.keys(readiness.byTerritory).length > 1 && (
            <div className="mt-3 space-y-1.5">
              {Object.entries(readiness.byTerritory)
                .sort(([, a], [, b]) => a.score - b.score)
                .map(([territory, data]) => (
                  <div key={territory} className="flex items-center gap-2">
                    <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-xs text-foreground w-24 truncate">{territory}</span>
                    <Progress value={data.score} className="h-1.5 flex-1" />
                    <span className="text-[10px] text-muted-foreground w-12 text-right">{data.completed}/{data.total}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Filter */}
      {territories.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Territory:</span>
          <Select value={territoryFilter} onValueChange={setTerritoryFilter}>
            <SelectTrigger className="h-7 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All territories</SelectItem>
              {territories.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Deliverable list */}
      <div className="space-y-1.5">
        {filtered.map(d => {
          const statusInfo = DELIVERABLE_STATUSES.find(s => s.value === d.status) || DELIVERABLE_STATUSES[0];
          const typeInfo = DELIVERABLE_TYPES.find(t => t.value === d.deliverable_type);
          return (
            <div key={d.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-medium text-foreground truncate">{d.item_name}</span>
                  {d.territory && (
                    <span className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0">{d.territory}</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge className="text-[9px] px-1.5 py-0 border bg-muted text-muted-foreground border-border">
                    {typeInfo?.label || d.deliverable_type}
                  </Badge>
                  {d.buyer_name && (
                    <span className="text-[10px] text-muted-foreground">{d.buyer_name}</span>
                  )}
                </div>
              </div>
              <Select value={d.status} onValueChange={v => handleStatusChange(d.id, v)}>
                <SelectTrigger className="h-6 w-28 text-[10px] border-0 bg-transparent">
                  <Badge className={cn('text-[10px] px-1.5 py-0 border', statusInfo.color)}>
                    {statusInfo.label}
                  </Badge>
                </SelectTrigger>
                <SelectContent>
                  {DELIVERABLE_STATUSES.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => deleteDeliverable.mutate(d.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>

      {/* Add form */}
      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input
            placeholder="Deliverable item (e.g. M&E Track, Chain of Title)"
            value={form.item_name}
            onChange={e => setForm(f => ({ ...f, item_name: e.target.value }))}
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Input
              placeholder="Territory"
              value={form.territory}
              onChange={e => setForm(f => ({ ...f, territory: e.target.value }))}
              className="h-8 text-sm flex-1"
            />
            <Input
              placeholder="Buyer"
              value={form.buyer_name}
              onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))}
              className="h-8 text-sm flex-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={form.deliverable_type} onValueChange={v => setForm(f => ({ ...f, deliverable_type: v }))}>
              <SelectTrigger className="h-8 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DELIVERABLE_TYPES.map(t => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.item_name.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {deliverables.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <PackageCheck className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Delivery Intelligence</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Track deliverables per territory and buyer — M&E tracks, chain of title, QC reports, and more. Monitor delivery readiness across all your sales commitments.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Add Deliverable
          </Button>
        </div>
      )}
    </motion.div>
  );
}
