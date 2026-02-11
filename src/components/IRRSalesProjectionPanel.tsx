import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, DollarSign, Globe, Plus, Trash2, ChevronDown, ChevronRight, Info, Percent,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, Cell, PieChart, Pie } from 'recharts';
import { calculateWaterfall, type RecoupmentTier } from '@/hooks/useRecoupment';

interface TerritoryRevenue {
  territory: string;
  estimatedRevenue: number;
  confidence: 'high' | 'medium' | 'low';
  source: string; // e.g. 'presale', 'estimate', 'deal'
}

const DEFAULT_TERRITORIES: TerritoryRevenue[] = [
  { territory: 'North America', estimatedRevenue: 0, confidence: 'medium', source: 'estimate' },
  { territory: 'UK / Ireland', estimatedRevenue: 0, confidence: 'medium', source: 'estimate' },
  { territory: 'Germany / Austria', estimatedRevenue: 0, confidence: 'medium', source: 'estimate' },
  { territory: 'France', estimatedRevenue: 0, confidence: 'medium', source: 'estimate' },
  { territory: 'Australia / NZ', estimatedRevenue: 0, confidence: 'medium', source: 'estimate' },
  { territory: 'Rest of World', estimatedRevenue: 0, confidence: 'low', source: 'estimate' },
];

const TERRITORY_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(210, 50%, 55%)',
  'hsl(30, 60%, 55%)',
  'hsl(280, 50%, 55%)',
];

function formatCurrency(val: number, currency = 'USD'): string {
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  if (Math.abs(val) >= 1_000_000) return `${sym}${(val / 1_000_000).toFixed(2)}M`;
  if (Math.abs(val) >= 1_000) return `${sym}${(val / 1_000).toFixed(0)}K`;
  return `${sym}${val.toFixed(0)}`;
}

// IRR calculation using Newton's method
function calculateIRR(cashflows: number[], maxIterations = 100): number | null {
  if (cashflows.length < 2) return null;
  const hasPositive = cashflows.some(c => c > 0);
  const hasNegative = cashflows.some(c => c < 0);
  if (!hasPositive || !hasNegative) return null;

  let rate = 0.1; // initial guess
  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashflows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashflows[t] / denom;
      dnpv -= t * cashflows[t] / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(dnpv) < 1e-10) break;
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < 1e-8) return newRate;
    rate = newRate;
    if (!isFinite(rate) || rate < -1) return null;
  }
  return isFinite(rate) ? rate : null;
}

interface Props {
  totalBudget?: number;
  totalRevenue?: number;
  tiers?: RecoupmentTier[];
  currency?: string;
}

export function IRRSalesProjectionPanel({ totalBudget = 0, totalRevenue = 0, tiers = [], currency = 'USD' }: Props) {
  const [territories, setTerritories] = useState<TerritoryRevenue[]>(DEFAULT_TERRITORIES);
  const [investmentAmount, setInvestmentAmount] = useState(totalBudget || 0);
  const [holdPeriodYears, setHoldPeriodYears] = useState(3);
  const [expanded, setExpanded] = useState(true);

  const totalTerritoryRevenue = useMemo(() =>
    territories.reduce((s, t) => s + t.estimatedRevenue, 0),
    [territories]
  );

  const effectiveRevenue = totalTerritoryRevenue || totalRevenue;

  // Calculate waterfall with territory revenue
  const waterfall = useMemo(() => {
    if (tiers.length === 0 || effectiveRevenue === 0) return null;
    return calculateWaterfall(effectiveRevenue, tiers);
  }, [effectiveRevenue, tiers]);

  // IRR calculation
  const irr = useMemo(() => {
    if (investmentAmount <= 0 || effectiveRevenue <= 0) return null;

    // Simple model: invest upfront, receive net revenue spread over hold period
    const investorReturn = waterfall
      ? waterfall.tiers
          .filter(t => t.tier.tier_type === 'recoup' || t.tier.tier_type === 'split' || t.tier.tier_type === 'corridor')
          .reduce((s, t) => s + t.amountReceived, 0)
      : effectiveRevenue;

    const annualReturn = investorReturn / holdPeriodYears;
    const cashflows = [-investmentAmount];
    for (let y = 0; y < holdPeriodYears; y++) {
      cashflows.push(annualReturn);
    }

    return calculateIRR(cashflows);
  }, [investmentAmount, effectiveRevenue, holdPeriodYears, waterfall]);

  const roi = investmentAmount > 0 ? ((effectiveRevenue - investmentAmount) / investmentAmount) * 100 : 0;
  const multiple = investmentAmount > 0 ? effectiveRevenue / investmentAmount : 0;

  const chartData = territories
    .filter(t => t.estimatedRevenue > 0)
    .sort((a, b) => b.estimatedRevenue - a.estimatedRevenue);

  const updateTerritory = (i: number, updates: Partial<TerritoryRevenue>) => {
    setTerritories(prev => prev.map((t, idx) => idx === i ? { ...t, ...updates } : t));
  };

  const addTerritory = () => {
    setTerritories(prev => [...prev, { territory: 'New Territory', estimatedRevenue: 0, confidence: 'low', source: 'estimate' }]);
  };

  const removeTerritory = (i: number) => {
    setTerritories(prev => prev.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-3">
      <button className="w-full flex items-center gap-2 text-left" onClick={() => setExpanded(!expanded)}>
        <TrendingUp className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1">IRR & Sales Projections</span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
          {/* Key metrics */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Total Revenue', value: formatCurrency(effectiveRevenue, currency), cls: 'text-emerald-400' },
              { label: 'ROI', value: `${roi.toFixed(0)}%`, cls: roi > 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Multiple', value: `${multiple.toFixed(2)}×`, cls: multiple >= 1 ? 'text-foreground' : 'text-red-400' },
              { label: 'IRR', value: irr !== null ? `${(irr * 100).toFixed(1)}%` : '—', cls: irr !== null && irr > 0 ? 'text-emerald-400' : 'text-muted-foreground' },
            ].map(s => (
              <div key={s.label} className="bg-muted/30 rounded-lg px-2 py-1.5">
                <p className={`text-sm font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Investment parameters */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Investment</label>
              <Input type="number" value={investmentAmount || ''} onChange={e => setInvestmentAmount(parseFloat(e.target.value) || 0)} className="h-7 text-xs" placeholder="Total investment" />
            </div>
            <div className="w-24">
              <label className="text-[10px] text-muted-foreground mb-0.5 block">Hold (yrs)</label>
              <Input type="number" value={holdPeriodYears} onChange={e => setHoldPeriodYears(parseInt(e.target.value) || 1)} className="h-7 text-xs" min={1} max={10} />
            </div>
          </div>

          {/* Territory chart */}
          {chartData.length > 0 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 10, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => formatCurrency(v, currency)} />
                  <YAxis type="category" dataKey="territory" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={75} />
                  <RechartsTooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(value: number) => [formatCurrency(value, currency), 'Revenue']}
                  />
                  <Bar dataKey="estimatedRevenue" radius={[0, 4, 4, 0]}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill={TERRITORY_COLORS[i % TERRITORY_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Territory editor */}
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Territory Revenue Estimates</p>
            {territories.map((t, i) => (
              <div key={i} className="flex items-center gap-1.5 bg-muted/20 rounded px-2 py-1">
                <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                <Input value={t.territory} onChange={e => updateTerritory(i, { territory: e.target.value })} className="h-6 text-[11px] flex-1 bg-transparent border-0 px-1" />
                <Input type="number" value={t.estimatedRevenue || ''} onChange={e => updateTerritory(i, { estimatedRevenue: parseFloat(e.target.value) || 0 })} className="h-6 text-[11px] w-24 bg-transparent border-0 px-1" placeholder="0" />
                <Select value={t.confidence} onValueChange={v => updateTerritory(i, { confidence: v as any })}>
                  <SelectTrigger className="h-6 text-[10px] w-16 border-0 bg-transparent px-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Med</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive" onClick={() => removeTerritory(i)}>
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="text-[11px] h-6" onClick={addTerritory}>
              <Plus className="h-3 w-3 mr-1" /> Add Territory
            </Button>
          </div>

          {/* Info footer */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-help">
                  <Info className="h-3 w-3" /> IRR assumes even annual distribution of investor returns over the hold period.
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                Internal Rate of Return (IRR) is calculated using Newton's method on simplified cashflows: investment upfront, annual returns spread over the hold period. For more precision, adjust the territory estimates and hold period.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </motion.div>
      )}
    </div>
  );
}
