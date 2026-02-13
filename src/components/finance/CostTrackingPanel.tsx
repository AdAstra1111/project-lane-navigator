import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Receipt, Plus, Trash2, Check, X, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useProjectCostEntries, type CostEntry } from '@/hooks/useCostEntries';
import { useProjectBudgets, useBudgetLines, BUDGET_CATEGORIES } from '@/hooks/useBudgets';

const CAT_STYLES: Record<string, string> = {
  atl: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  btl: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  post: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  vfx: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  logistics: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  schedule: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  contingency: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'soft-money': 'bg-lime-500/15 text-lime-400 border-lime-500/30',
  other: 'bg-muted text-muted-foreground border-border',
};

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Props {
  projectId: string;
}

export function CostTrackingPanel({ projectId }: Props) {
  const { entries, addEntry, deleteEntry } = useProjectCostEntries(projectId);
  const { budgets } = useProjectBudgets(projectId);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    description: '', amount: '', category: 'other', vendor: '', entry_date: new Date().toISOString().slice(0, 10), budget_id: '',
  });

  // Find locked budget for variance tracking
  const lockedBudget = budgets.find(b => b.status === 'locked') || budgets[0];
  const { lines: budgetLines } = useBudgetLines(lockedBudget?.id, projectId);

  const analytics = useMemo(() => {
    const totalSpent = entries.reduce((s, e) => s + Number(e.amount), 0);
    const budgetTotal = budgetLines.reduce((s, l) => s + Number(l.amount), 0);

    // Category breakdown
    const byCat: Record<string, { spent: number; budgeted: number }> = {};
    for (const cat of BUDGET_CATEGORIES) {
      const budgeted = budgetLines.filter(l => l.category === cat.value).reduce((s, l) => s + Number(l.amount), 0);
      const spent = entries.filter(e => e.category === cat.value).reduce((s, e) => s + Number(e.amount), 0);
      if (budgeted > 0 || spent > 0) byCat[cat.value] = { spent, budgeted };
    }

    // Overruns
    const overruns = Object.entries(byCat)
      .filter(([, v]) => v.budgeted > 0 && v.spent > v.budgeted)
      .map(([cat, v]) => ({
        category: cat,
        label: BUDGET_CATEGORIES.find(c => c.value === cat)?.label || cat,
        overrun: v.spent - v.budgeted,
        pct: ((v.spent - v.budgeted) / v.budgeted) * 100,
      }));

    // Burn rate (weekly average)
    const sortedDates = entries.map(e => new Date(e.entry_date).getTime()).sort((a, b) => a - b);
    let weeklyBurn = 0;
    if (sortedDates.length >= 2) {
      const spanMs = sortedDates[sortedDates.length - 1] - sortedDates[0];
      const weeks = Math.max(1, spanMs / (7 * 24 * 60 * 60 * 1000));
      weeklyBurn = totalSpent / weeks;
    }

    const burnPct = budgetTotal > 0 ? (totalSpent / budgetTotal) * 100 : 0;

    return { totalSpent, budgetTotal, byCat, overruns, weeklyBurn, burnPct };
  }, [entries, budgetLines]);

  const handleAdd = () => {
    if (!form.description.trim()) return;
    addEntry.mutate({
      description: form.description,
      amount: parseFloat(form.amount) || 0,
      category: form.category,
      vendor: form.vendor,
      entry_date: form.entry_date,
      budget_id: form.budget_id || null,
    });
    setForm({ description: '', amount: '', category: 'other', vendor: '', entry_date: new Date().toISOString().slice(0, 10), budget_id: '' });
    setAdding(false);
  };

  const burnColor = analytics.burnPct > 90 ? 'text-red-400' : analytics.burnPct > 70 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.3 }}
      className="space-y-4"
    >
      {/* Summary */}
      {entries.length > 0 && (
        <div className="glass-card rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Cost Summary</span>
            </div>
            <span className={cn('text-lg font-bold font-display', burnColor)}>
              {fmt(analytics.totalSpent)}
            </span>
          </div>

          {analytics.budgetTotal > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>of {fmt(analytics.budgetTotal)} budgeted</span>
                <span className={burnColor}>{analytics.burnPct.toFixed(1)}% spent</span>
              </div>
              <Progress value={Math.min(100, analytics.burnPct)} className="h-2" />
            </>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Weekly Burn</p>
              <p className="text-sm font-bold text-foreground">{fmt(analytics.weeklyBurn)}/wk</p>
            </div>
            <div className="bg-muted/30 rounded-lg px-3 py-2 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Remaining</p>
              <p className={cn('text-sm font-bold', analytics.budgetTotal - analytics.totalSpent < 0 ? 'text-red-400' : 'text-foreground')}>
                {fmt(Math.max(0, analytics.budgetTotal - analytics.totalSpent))}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Variance by category */}
      {Object.keys(analytics.byCat).length > 0 && analytics.budgetTotal > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Category Variance</p>
          {Object.entries(analytics.byCat).map(([cat, { spent, budgeted }]) => {
            const variance = budgeted > 0 ? ((spent - budgeted) / budgeted) * 100 : 0;
            const over = spent > budgeted && budgeted > 0;
            const catLabel = BUDGET_CATEGORIES.find(c => c.value === cat)?.label || cat;
            return (
              <div key={cat} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-1.5">
                <Badge className={cn('text-[9px] px-1.5 py-0 border shrink-0', CAT_STYLES[cat] || CAT_STYLES.other)}>
                  {catLabel}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between text-xs">
                    <span className="text-foreground">{fmt(spent)}</span>
                    {budgeted > 0 && <span className="text-muted-foreground">/ {fmt(budgeted)}</span>}
                  </div>
                  {budgeted > 0 && (
                    <Progress value={Math.min(100, (spent / budgeted) * 100)} className="h-1 mt-1" />
                  )}
                </div>
                {budgeted > 0 && (
                  <span className={cn('text-[10px] font-medium w-14 text-right shrink-0', over ? 'text-red-400' : 'text-emerald-400')}>
                    {over ? '+' : ''}{variance.toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Overrun alerts */}
      {analytics.overruns.length > 0 && (
        <div className="space-y-1.5">
          {analytics.overruns.map(o => (
            <div key={o.category} className="flex items-center gap-2 bg-red-500/5 border border-red-500/15 rounded-lg px-3 py-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              <span className="text-foreground font-medium">{o.label}</span>
              <span className="text-red-400">+{fmt(o.overrun)} over budget ({o.pct.toFixed(0)}%)</span>
            </div>
          ))}
        </div>
      )}

      {/* Entry list */}
      <div className="space-y-1">
        {entries.slice(0, 20).map(e => {
          const catLabel = BUDGET_CATEGORIES.find(c => c.value === e.category)?.label || e.category;
          return (
            <div key={e.id} className="flex items-center gap-2 bg-muted/20 rounded-lg px-3 py-1.5">
              <Badge className={cn('text-[9px] px-1.5 py-0 border shrink-0', CAT_STYLES[e.category] || CAT_STYLES.other)}>
                {catLabel}
              </Badge>
              <div className="flex-1 min-w-0">
                <span className="text-xs text-foreground truncate block">{e.description}</span>
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  {e.vendor && <span>{e.vendor}</span>}
                  <span>{new Date(e.entry_date).toLocaleDateString()}</span>
                </div>
              </div>
              <span className="text-xs font-medium text-foreground shrink-0">{fmt(Number(e.amount))}</span>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0" onClick={() => deleteEntry.mutate(e.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
        {entries.length > 20 && (
          <p className="text-xs text-muted-foreground text-center py-1">+ {entries.length - 20} more entries</p>
        )}
      </div>

      {/* Add form */}
      {adding ? (
        <div className="space-y-2 bg-muted/20 rounded-lg px-3 py-2">
          <Input placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-8 text-sm" />
          <div className="flex gap-2">
            <Input placeholder="Amount" type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-8 text-sm w-28" />
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUDGET_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Input placeholder="Vendor" value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))} className="h-8 text-sm flex-1" />
            <Input type="date" value={form.entry_date} onChange={e => setForm(f => ({ ...f, entry_date: e.target.value }))} className="h-8 text-sm w-36" />
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" className="h-7 w-7" onClick={handleAdd} disabled={!form.description.trim()}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAdding(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.length === 0 && (
            <div className="text-center py-4 space-y-2">
              <Receipt className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm font-medium text-foreground">Cost Tracking</p>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
                Log actual costs against your budget categories. Track variance, weekly burn rate, and get alerts when spending exceeds budget allocations.
              </p>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-3.5 w-3.5 mr-1.5" /> Log Cost
          </Button>
        </div>
      )}
    </motion.div>
  );
}
