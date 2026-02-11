import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, DollarSign, Calendar, ArrowRight, Info, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell, Line, ComposedChart, Area } from 'recharts';

interface CashflowMonth {
  month: string;
  label: string;
  inflows: number;
  outflows: number;
  net: number;
  cumulative: number;
}

interface CashflowSource {
  name: string;
  type: 'inflow' | 'outflow';
  amount: number;
  startMonth: number; // 0-indexed from production start
  durationMonths: number;
  timing: 'upfront' | 'monthly' | 'backend' | 'milestone';
}

function formatCurrency(val: number, currency = 'USD'): string {
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  if (Math.abs(val) >= 1_000_000) return `${sym}${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${sym}${(val / 1_000).toFixed(0)}K`;
  return `${sym}${val.toFixed(0)}`;
}

const DEFAULT_SOURCES: CashflowSource[] = [
  { name: 'Equity Draw', type: 'inflow', amount: 0, startMonth: 0, durationMonths: 1, timing: 'upfront' },
  { name: 'Tax Credit Advance', type: 'inflow', amount: 0, startMonth: 1, durationMonths: 1, timing: 'upfront' },
  { name: 'Pre-Sales MGs', type: 'inflow', amount: 0, startMonth: 2, durationMonths: 3, timing: 'milestone' },
  { name: 'Tax Credit Rebate', type: 'inflow', amount: 0, startMonth: 8, durationMonths: 1, timing: 'backend' },
  { name: 'Pre-Production', type: 'outflow', amount: 0, startMonth: 0, durationMonths: 2, timing: 'monthly' },
  { name: 'Production', type: 'outflow', amount: 0, startMonth: 2, durationMonths: 3, timing: 'monthly' },
  { name: 'Post-Production', type: 'outflow', amount: 0, startMonth: 5, durationMonths: 4, timing: 'monthly' },
  { name: 'Delivery & Marketing', type: 'outflow', amount: 0, startMonth: 9, durationMonths: 2, timing: 'monthly' },
];

const TIMING_LABELS: Record<string, string> = {
  upfront: 'Lump sum at start',
  monthly: 'Spread evenly',
  backend: 'Lump sum at end',
  milestone: 'Milestone-based (spread)',
};

interface Props {
  totalBudget?: number;
  currency?: string;
}

export function CashflowModelPanel({ totalBudget = 0, currency = 'USD' }: Props) {
  const [sources, setSources] = useState<CashflowSource[]>(DEFAULT_SOURCES);
  const [months, setMonths] = useState(12);
  const [expanded, setExpanded] = useState(true);

  const updateSource = (i: number, updates: Partial<CashflowSource>) => {
    setSources(prev => prev.map((s, idx) => idx === i ? { ...s, ...updates } : s));
  };

  const addSource = (type: 'inflow' | 'outflow') => {
    setSources(prev => [...prev, {
      name: type === 'inflow' ? 'New Inflow' : 'New Outflow',
      type,
      amount: 0,
      startMonth: 0,
      durationMonths: 1,
      timing: 'monthly',
    }]);
  };

  const removeSource = (i: number) => setSources(prev => prev.filter((_, idx) => idx !== i));

  const cashflow = useMemo(() => {
    const data: CashflowMonth[] = [];
    let cumulative = 0;

    for (let m = 0; m < months; m++) {
      let inflows = 0;
      let outflows = 0;

      for (const src of sources) {
        if (src.amount <= 0) continue;
        const isInRange = m >= src.startMonth && m < src.startMonth + src.durationMonths;
        if (!isInRange) continue;

        let monthAmount = 0;
        if (src.timing === 'upfront' && m === src.startMonth) {
          monthAmount = src.amount;
        } else if (src.timing === 'backend' && m === src.startMonth + src.durationMonths - 1) {
          monthAmount = src.amount;
        } else if (src.timing === 'monthly' || src.timing === 'milestone') {
          monthAmount = src.amount / src.durationMonths;
        }

        if (src.type === 'inflow') inflows += monthAmount;
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

  const totalInflows = sources.filter(s => s.type === 'inflow').reduce((s, src) => s + src.amount, 0);
  const totalOutflows = sources.filter(s => s.type === 'outflow').reduce((s, src) => s + src.amount, 0);
  const minCumulative = Math.min(...cashflow.map(c => c.cumulative));
  const peakCashNeed = Math.abs(Math.min(0, minCumulative));

  return (
    <div className="space-y-3">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setExpanded(!expanded)}>
        <Calendar className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1">Dynamic Cashflow Model</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
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

          {/* Sources editor */}
          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Inflows</p>
            {sources.filter(s => s.type === 'inflow').map((src, _i) => {
              const i = sources.indexOf(src);
              return (
                <div key={i} className="flex items-center gap-1.5 bg-muted/20 rounded px-2 py-1">
                  <Input value={src.name} onChange={e => updateSource(i, { name: e.target.value })} className="h-6 text-[11px] flex-1 bg-transparent border-0 px-1" />
                  <Input type="number" value={src.amount || ''} onChange={e => updateSource(i, { amount: parseFloat(e.target.value) || 0 })} className="h-6 text-[11px] w-20 bg-transparent border-0 px-1" placeholder="0" />
                  <Select value={String(src.startMonth)} onValueChange={v => updateSource(i, { startMonth: parseInt(v) })}>
                    <SelectTrigger className="h-6 text-[11px] w-14 border-0 bg-transparent px-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Array.from({ length: months }, (_, m) => <SelectItem key={m} value={String(m)}>M{m+1}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" value={src.durationMonths} onChange={e => updateSource(i, { durationMonths: parseInt(e.target.value) || 1 })} className="h-6 text-[11px] w-10 bg-transparent border-0 px-1" min={1} />
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => removeSource(i)}>×</Button>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" className="text-[11px] h-6" onClick={() => addSource('inflow')}>+ Inflow</Button>

            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">Outflows</p>
            {sources.filter(s => s.type === 'outflow').map((src) => {
              const i = sources.indexOf(src);
              return (
                <div key={i} className="flex items-center gap-1.5 bg-muted/20 rounded px-2 py-1">
                  <Input value={src.name} onChange={e => updateSource(i, { name: e.target.value })} className="h-6 text-[11px] flex-1 bg-transparent border-0 px-1" />
                  <Input type="number" value={src.amount || ''} onChange={e => updateSource(i, { amount: parseFloat(e.target.value) || 0 })} className="h-6 text-[11px] w-20 bg-transparent border-0 px-1" placeholder="0" />
                  <Select value={String(src.startMonth)} onValueChange={v => updateSource(i, { startMonth: parseInt(v) })}>
                    <SelectTrigger className="h-6 text-[11px] w-14 border-0 bg-transparent px-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{Array.from({ length: months }, (_, m) => <SelectItem key={m} value={String(m)}>M{m+1}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" value={src.durationMonths} onChange={e => updateSource(i, { durationMonths: parseInt(e.target.value) || 1 })} className="h-6 text-[11px] w-10 bg-transparent border-0 px-1" min={1} />
                  <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => removeSource(i)}>×</Button>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" className="text-[11px] h-6" onClick={() => addSource('outflow')}>+ Outflow</Button>
          </div>

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
