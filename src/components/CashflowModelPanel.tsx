import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Calendar, ChevronDown, ChevronRight, RefreshCw, Plus, Loader2, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { useCashflowSources, generateSyncedSources, fetchBudgetLinesForSync, type CashflowSource } from '@/hooks/useCashflow';

interface CashflowMonth {
  month: string;
  label: string;
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
}

function formatCurrency(val: number, currency = 'USD'): string {
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  if (Math.abs(val) >= 1_000_000) return `${sym}${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${sym}${(val / 1_000).toFixed(0)}K`;
  return `${sym}${val.toFixed(0)}`;
}

const ORIGIN_BADGES: Record<string, string> = {
  'deal-sync': 'Deal',
  'budget-sync': 'Budget',
  'schedule-sync': 'Schedule',
  'incentive-sync': 'Incentive',
  manual: 'Manual',
};

interface Props {
  projectId: string;
  totalBudget?: number;
  currency?: string;
  deals?: any[];
  budgets?: any[];
  incentiveScenarios?: any[];
  shootDayCount?: number;
}

export function CashflowModelPanel({
  projectId,
  totalBudget = 0,
  currency = 'USD',
  deals = [],
  budgets = [],
  incentiveScenarios = [],
  shootDayCount = 0,
}: Props) {
  const { sources, isLoading, addSource, updateSource, deleteSource, bulkReplace } = useCashflowSources(projectId);
  const [months, setMonths] = useState(12);
  const [expanded, setExpanded] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      // Fetch budget lines for the active budget
      const activeBudget = budgets.find((b: any) => b.status === 'locked') || budgets[0];
      let budgetLines: any[] = [];
      if (activeBudget) {
        budgetLines = await fetchBudgetLinesForSync(projectId, activeBudget.id);
      }
      const synced = generateSyncedSources(deals, budgets, budgetLines, incentiveScenarios, shootDayCount);
      await bulkReplace.mutateAsync(synced);
    } finally {
      setSyncing(false);
    }
  }, [deals, budgets, incentiveScenarios, shootDayCount, bulkReplace, projectId]);

  const handleAddSource = (type: 'inflow' | 'outflow') => {
    addSource.mutate({
      name: type === 'inflow' ? 'New Inflow' : 'New Outflow',
      source_type: type,
      amount: 0,
      start_month: 0,
      duration_months: 1,
      timing: 'monthly',
      origin: 'manual',
      origin_ref_id: null,
      sort_order: sources.length,
    });
  };

  const cashflow = useMemo(() => {
    const data: CashflowMonth[] = [];
    let cumulative = 0;

    for (let m = 0; m < months; m++) {
      let inflows = 0;
      let outflows = 0;

      for (const src of sources) {
        if (src.amount <= 0) continue;
        const isInRange = m >= src.start_month && m < src.start_month + src.duration_months;
        if (!isInRange) continue;

        let monthAmount = 0;
        if (src.timing === 'upfront' && m === src.start_month) {
          monthAmount = src.amount;
        } else if (src.timing === 'backend' && m === src.start_month + src.duration_months - 1) {
          monthAmount = src.amount;
        } else if (src.timing === 'monthly' || src.timing === 'milestone') {
          monthAmount = src.amount / src.duration_months;
        }

        if (src.source_type === 'inflow') inflows += monthAmount;
        else outflows += monthAmount;
      }

      const net = inflows - outflows;
      cumulative += net;

      data.push({
        month: `M${m + 1}`,
        label: `Month ${m + 1}`,
        inflows,
        outflows,
        net,
        cumulative,
      });
    }

    return data;
  }, [sources, months]);

  const totalInflows = sources.filter(s => s.source_type === 'inflow').reduce((s, src) => s + src.amount, 0);
  const totalOutflows = sources.filter(s => s.source_type === 'outflow').reduce((s, src) => s + src.amount, 0);
  const minCumulative = Math.min(...cashflow.map(c => c.cumulative), 0);
  const peakCashNeed = Math.abs(minCumulative);

  const inflows = sources.filter(s => s.source_type === 'inflow');
  const outflows = sources.filter(s => s.source_type === 'outflow');

  const hasProjectData = deals.length > 0 || budgets.length > 0 || incentiveScenarios.length > 0;

  return (
    <div className="space-y-3">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setExpanded(!expanded)}>
        <Calendar className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1">Dynamic Cashflow Model</span>
        {sources.length > 0 && <Badge variant="outline" className="text-[10px]">{sources.length} sources</Badge>}
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          {/* Sync button */}
          {hasProjectData && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs gap-1.5 w-full"
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Sync from Project Data
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Pulls closed deals as inflows, budget categories as outflows, and incentive scenarios as backend receipts. Manual entries are preserved.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Summary */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Inflows', value: formatCurrency(totalInflows, currency), cls: 'text-emerald-400' },
              { label: 'Outflows', value: formatCurrency(totalOutflows, currency), cls: 'text-red-400' },
              { label: 'Peak Cash Need', value: formatCurrency(peakCashNeed, currency), cls: peakCashNeed > 0 ? 'text-amber-400' : 'text-muted-foreground' },
              { label: 'Timeline', value: `${months}mo`, cls: 'text-foreground' },
            ].map(s => (
              <div key={s.label} className="bg-muted/30 rounded-lg px-2 py-1.5">
                <p className={`text-sm font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Chart */}
          {cashflow.some(c => c.inflows > 0 || c.outflows > 0) && (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashflow} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => formatCurrency(v, currency)} />
                  <RechartsTooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number, name: string) => [formatCurrency(value, currency), name]}
                  />
                  <Bar dataKey="inflows" name="Inflows" fill="hsl(145, 60%, 45%)" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="outflows" name="Outflows" fill="hsl(0, 70%, 55%)" radius={[2, 2, 0, 0]} />
                  <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Empty state */}
          {sources.length === 0 && !isLoading && (
            <div className="text-center py-4 text-muted-foreground text-xs space-y-2">
              <p>No cashflow sources yet.</p>
              {hasProjectData ? (
                <p>Click <strong>Sync from Project Data</strong> to auto-populate from your deals, budgets, and incentives.</p>
              ) : (
                <p>Add inflows and outflows manually, or add deals/budgets first then sync.</p>
              )}
            </div>
          )}

          {/* Sources editor */}
          {sources.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Inflows</p>
              {inflows.map(src => (
                <SourceRow
                  key={src.id}
                  source={src}
                  months={months}
                  currency={currency}
                  onUpdate={(updates) => updateSource.mutate({ id: src.id, ...updates })}
                  onDelete={() => deleteSource.mutate(src.id)}
                />
              ))}
              <Button variant="ghost" size="sm" className="text-[11px] h-6" onClick={() => handleAddSource('inflow')}>
                <Plus className="h-3 w-3 mr-1" /> Inflow
              </Button>

              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Outflows</p>
              {outflows.map(src => (
                <SourceRow
                  key={src.id}
                  source={src}
                  months={months}
                  currency={currency}
                  onUpdate={(updates) => updateSource.mutate({ id: src.id, ...updates })}
                  onDelete={() => deleteSource.mutate(src.id)}
                />
              ))}
              <Button variant="ghost" size="sm" className="text-[11px] h-6" onClick={() => handleAddSource('outflow')}>
                <Plus className="h-3 w-3 mr-1" /> Outflow
              </Button>
            </div>
          )}

          {/* Timeline control */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Timeline:</span>
            {[6, 12, 18, 24].map(m => (
              <button key={m} onClick={() => setMonths(m)} className={`px-2 py-0.5 rounded text-[10px] border ${months === m ? 'bg-primary/15 border-primary/40 text-primary' : 'border-border/50 text-muted-foreground hover:bg-muted/30'}`}>
                {m}mo
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ── Source Row (inline editor) ──
function SourceRow({
  source,
  months,
  currency,
  onUpdate,
  onDelete,
}: {
  source: CashflowSource;
  months: number;
  currency: string;
  onUpdate: (updates: Partial<CashflowSource>) => void;
  onDelete: () => void;
}) {
  const originBadge = ORIGIN_BADGES[source.origin] || source.origin;

  return (
    <div className="flex items-center gap-1.5 bg-muted/20 rounded px-2 py-1">
      <Input
        value={source.name}
        onChange={e => onUpdate({ name: e.target.value })}
        className="h-6 text-[11px] flex-1 bg-transparent border-0 px-1"
      />
      {source.origin !== 'manual' && (
        <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">{originBadge}</Badge>
      )}
      <Input
        type="number"
        value={source.amount || ''}
        onChange={e => onUpdate({ amount: parseFloat(e.target.value) || 0 })}
        className="h-6 text-[11px] w-20 bg-transparent border-0 px-1"
        placeholder="0"
      />
      <Select value={String(source.start_month)} onValueChange={v => onUpdate({ start_month: parseInt(v) })}>
        <SelectTrigger className="h-6 text-[11px] w-14 border-0 bg-transparent px-1"><SelectValue /></SelectTrigger>
        <SelectContent>{Array.from({ length: months }, (_, m) => <SelectItem key={m} value={String(m)}>M{m + 1}</SelectItem>)}</SelectContent>
      </Select>
      <Input
        type="number"
        value={source.duration_months}
        onChange={e => onUpdate({ duration_months: parseInt(e.target.value) || 1 })}
        className="h-6 text-[11px] w-10 bg-transparent border-0 px-1"
        min={1}
      />
      <Select value={source.timing} onValueChange={v => onUpdate({ timing: v as any })}>
        <SelectTrigger className="h-6 text-[10px] w-16 border-0 bg-transparent px-1"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="upfront">Lump</SelectItem>
          <SelectItem value="monthly">Monthly</SelectItem>
          <SelectItem value="backend">Backend</SelectItem>
          <SelectItem value="milestone">Milestone</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive shrink-0" onClick={onDelete}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}
