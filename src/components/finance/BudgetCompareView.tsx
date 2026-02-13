import { useState, useMemo } from 'react';
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useBudgetLines, BUDGET_CATEGORIES, type ProjectBudget } from '@/hooks/useBudgets';
import { cn } from '@/lib/utils';

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

function fmt(n: number, currency: string) {
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function DeltaBadge({ delta, pctDelta }: { delta: number; pctDelta: number }) {
  if (delta === 0) return <Minus className="h-3 w-3 text-muted-foreground" />;
  const positive = delta > 0;
  return (
    <span className={cn('flex items-center gap-0.5 text-[10px] font-medium', positive ? 'text-emerald-400' : 'text-red-400')}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{pctDelta.toFixed(1)}%
    </span>
  );
}

interface Props {
  budgets: ProjectBudget[];
  projectId: string;
  onBack: () => void;
}

export function BudgetCompareView({ budgets, projectId, onBack }: Props) {
  const [leftId, setLeftId] = useState(budgets[1]?.id || '');
  const [rightId, setRightId] = useState(budgets[0]?.id || '');

  const { lines: leftLines } = useBudgetLines(leftId || undefined, projectId);
  const { lines: rightLines } = useBudgetLines(rightId || undefined, projectId);

  const leftBudget = budgets.find(b => b.id === leftId);
  const rightBudget = budgets.find(b => b.id === rightId);

  const comparison = useMemo(() => {
    const catMap = new Map<string, { left: number; right: number }>();

    for (const cat of BUDGET_CATEGORIES) {
      catMap.set(cat.value, { left: 0, right: 0 });
    }

    for (const l of leftLines) {
      const entry = catMap.get(l.category) || { left: 0, right: 0 };
      entry.left += Number(l.amount);
      catMap.set(l.category, entry);
    }

    for (const l of rightLines) {
      const entry = catMap.get(l.category) || { left: 0, right: 0 };
      entry.right += Number(l.amount);
      catMap.set(l.category, entry);
    }

    const leftTotal = leftLines.reduce((s, l) => s + Number(l.amount), 0);
    const rightTotal = rightLines.reduce((s, l) => s + Number(l.amount), 0);

    const rows = BUDGET_CATEGORIES
      .map(cat => {
        const entry = catMap.get(cat.value)!;
        if (entry.left === 0 && entry.right === 0) return null;
        const delta = entry.right - entry.left;
        const pctDelta = entry.left > 0 ? ((delta / entry.left) * 100) : (entry.right > 0 ? 100 : 0);
        const leftPct = leftTotal > 0 ? (entry.left / leftTotal) * 100 : 0;
        const rightPct = rightTotal > 0 ? (entry.right / rightTotal) * 100 : 0;
        return { ...cat, ...entry, delta, pctDelta, leftPct, rightPct };
      })
      .filter(Boolean) as Array<{
        value: string; label: string;
        left: number; right: number; delta: number; pctDelta: number;
        leftPct: number; rightPct: number;
      }>;

    return { rows, leftTotal, rightTotal, totalDelta: rightTotal - leftTotal };
  }, [leftLines, rightLines]);

  const totalPctDelta = comparison.leftTotal > 0
    ? ((comparison.totalDelta / comparison.leftTotal) * 100)
    : 0;

  const currency = leftBudget?.currency || rightBudget?.currency || 'USD';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
          <ArrowLeft className="h-3 w-3 mr-1" /> Back
        </Button>
        <ArrowLeftRight className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Compare Budgets</span>
      </div>

      {/* Selectors */}
      <div className="grid grid-cols-2 gap-3">
        <Select value={leftId} onValueChange={setLeftId}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select base…" /></SelectTrigger>
          <SelectContent>
            {budgets.filter(b => b.id !== rightId).map(b => (
              <SelectItem key={b.id} value={b.id} className="text-xs">{b.version_label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rightId} onValueChange={setRightId}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select compare…" /></SelectTrigger>
          <SelectContent>
            {budgets.filter(b => b.id !== leftId).map(b => (
              <SelectItem key={b.id} value={b.id} className="text-xs">{b.version_label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Total comparison */}
      {leftId && rightId && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-muted/30 rounded-lg px-2 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{leftBudget?.version_label}</p>
              <p className="text-sm font-bold text-foreground">{fmt(comparison.leftTotal, currency)}</p>
            </div>
            <div className="bg-muted/30 rounded-lg px-2 py-2 flex flex-col items-center justify-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Δ Change</p>
              <div className="flex items-center gap-1">
                <span className={cn('text-sm font-bold', comparison.totalDelta > 0 ? 'text-emerald-400' : comparison.totalDelta < 0 ? 'text-red-400' : 'text-foreground')}>
                  {comparison.totalDelta > 0 ? '+' : ''}{fmt(comparison.totalDelta, currency)}
                </span>
              </div>
              <DeltaBadge delta={comparison.totalDelta} pctDelta={totalPctDelta} />
            </div>
            <div className="bg-muted/30 rounded-lg px-2 py-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{rightBudget?.version_label}</p>
              <p className="text-sm font-bold text-foreground">{fmt(comparison.rightTotal, currency)}</p>
            </div>
          </div>

          {/* Category rows */}
          <div className="space-y-1">
            {comparison.rows.map(row => (
              <div key={row.value} className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center bg-muted/20 rounded-lg px-3 py-2">
                {/* Left */}
                <div className="text-right">
                  <span className="text-xs font-medium text-foreground">{fmt(row.left, '')}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">({row.leftPct.toFixed(0)}%)</span>
                </div>
                {/* Center */}
                <div className="flex flex-col items-center gap-0.5 min-w-[80px]">
                  <Badge className={cn('text-[9px] px-1.5 py-0 border', CAT_STYLES[row.value] || CAT_STYLES.other)}>
                    {row.label}
                  </Badge>
                  <DeltaBadge delta={row.delta} pctDelta={row.pctDelta} />
                </div>
                {/* Right */}
                <div className="text-left">
                  <span className="text-xs font-medium text-foreground">{fmt(row.right, '')}</span>
                  <span className="text-[10px] text-muted-foreground ml-1">({row.rightPct.toFixed(0)}%)</span>
                </div>
              </div>
            ))}
          </div>

          {/* Allocation shift bar */}
          {comparison.rows.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{leftBudget?.version_label} allocation</p>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
                {comparison.rows.map(row => (
                  <div
                    key={`l-${row.value}`}
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${row.leftPct}%`,
                      background: row.value === 'atl' ? 'hsl(270,60%,60%)'
                        : row.value === 'btl' ? 'hsl(200,70%,55%)'
                        : row.value === 'post' ? 'hsl(35,80%,55%)'
                        : row.value === 'vfx' ? 'hsl(340,65%,55%)'
                        : row.value === 'contingency' ? 'hsl(25,85%,55%)'
                        : 'hsl(var(--primary))',
                    }}
                  />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{rightBudget?.version_label} allocation</p>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
                {comparison.rows.map(row => (
                  <div
                    key={`r-${row.value}`}
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${row.rightPct}%`,
                      background: row.value === 'atl' ? 'hsl(270,60%,60%)'
                        : row.value === 'btl' ? 'hsl(200,70%,55%)'
                        : row.value === 'post' ? 'hsl(35,80%,55%)'
                        : row.value === 'vfx' ? 'hsl(340,65%,55%)'
                        : row.value === 'contingency' ? 'hsl(25,85%,55%)'
                        : 'hsl(var(--primary))',
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
