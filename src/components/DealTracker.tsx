import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Handshake, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useProjectDeals, DEAL_STATUSES, DEAL_TYPES, type ProjectDeal } from '@/hooks/useDeals';

const STATUS_COLORS: Record<string, string> = {
  offered: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  negotiating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'term-sheet': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  closed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  passed: 'bg-red-500/15 text-red-400 border-red-500/30',
};

export function DealTracker({ projectId }: { projectId: string }) {
  const { deals, addDeal, updateDeal, deleteDeal, totalMG } = useProjectDeals(projectId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ territory: '', buyer_name: '', deal_type: 'all-rights', minimum_guarantee: '', currency: 'USD' });

  const handleAdd = () => {
    addDeal.mutate(form);
    setForm({ territory: '', buyer_name: '', deal_type: 'all-rights', minimum_guarantee: '', currency: 'USD' });
    setShowForm(false);
  };

  const closedDeals = deals.filter(d => d.status === 'closed').length;
  const activeDeals = deals.filter(d => !['closed', 'passed'].includes(d.status)).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Handshake className="h-5 w-5 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Deal Tracker</h3>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Deal
        </Button>
      </div>

      {/* Summary */}
      {deals.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{activeDeals}</p>
            <p className="text-xs text-muted-foreground">Active</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{closedDeals}</p>
            <p className="text-xs text-muted-foreground">Closed</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <p className="text-2xl font-bold text-foreground flex items-center justify-center gap-1">
              <TrendingUp className="h-4 w-4" />
              {totalMG > 0 ? `$${(totalMG / 1000).toFixed(0)}K` : '—'}
            </p>
            <p className="text-xs text-muted-foreground">Total MG</p>
          </div>
        </div>
      )}

      {/* Add Form */}
      {showForm && (
        <div className="border border-border rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Territory (e.g. France)" value={form.territory} onChange={e => setForm(f => ({ ...f, territory: e.target.value }))} />
            <Input placeholder="Buyer name" value={form.buyer_name} onChange={e => setForm(f => ({ ...f, buyer_name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select value={form.deal_type} onValueChange={v => setForm(f => ({ ...f, deal_type: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEAL_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/-/g, ' ')}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input placeholder="Minimum Guarantee (e.g. 50000)" value={form.minimum_guarantee} onChange={e => setForm(f => ({ ...f, minimum_guarantee: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!form.territory || !form.buyer_name}>Add</Button>
          </div>
        </div>
      )}

      {/* Deal List */}
      {deals.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No deals tracked yet. Add your first territory deal above.</p>
      ) : (
        <div className="space-y-2">
          {deals.map(deal => (
            <div key={deal.id} className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors group">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-medium text-sm text-foreground truncate">{deal.territory}</span>
                <span className="text-xs text-muted-foreground truncate">{deal.buyer_name}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">{deal.deal_type.replace(/-/g, ' ')}</Badge>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {deal.minimum_guarantee && (
                  <span className="text-xs font-medium text-foreground">${deal.minimum_guarantee}</span>
                )}
                <Select value={deal.status} onValueChange={v => updateDeal.mutate({ id: deal.id, status: v, ...(v === 'closed' ? { closed_at: new Date().toISOString() } : {}) })}>
                  <SelectTrigger className="h-7 w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEAL_STATUSES.map(s => <SelectItem key={s} value={s}>{s.replace(/-/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => deleteDeal.mutate(deal.id)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
