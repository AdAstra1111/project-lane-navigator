import { useState, useMemo } from 'react';
import { Plus, Trash2, ChevronDown, ChevronUp, GripVertical, DollarSign, Percent, ArrowDown, TrendingUp, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Cell, Tooltip as RechartsTooltip } from 'recharts';
import {
  useRecoupmentScenarios,
  useRecoupmentTiers,
  calculateWaterfall,
  TIER_TYPES,
  type RecoupmentTier,
} from '@/hooks/useRecoupment';

const TIER_COLORS: Record<string, string> = {
  fee_pct: 'hsl(var(--chart-1))',
  expense: 'hsl(var(--chart-2))',
  recoup: 'hsl(var(--chart-3))',
  corridor: 'hsl(var(--chart-4))',
  split: 'hsl(var(--chart-5))',
};

const TIER_BADGE_CLASSES: Record<string, string> = {
  fee_pct: 'bg-chart-1/15 text-chart-1 border-chart-1/30',
  expense: 'bg-chart-2/15 text-chart-2 border-chart-2/30',
  recoup: 'bg-chart-3/15 text-chart-3 border-chart-3/30',
  corridor: 'bg-chart-4/15 text-chart-4 border-chart-4/30',
  split: 'bg-chart-5/15 text-chart-5 border-chart-5/30',
};

function formatCurrency(amount: number, currency = 'USD'): string {
  if (amount >= 1_000_000) return `${currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'}${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'}${(amount / 1_000).toFixed(0)}K`;
  return `${currency === 'USD' ? '$' : currency === 'GBP' ? '£' : '€'}${amount.toFixed(0)}`;
}

// ─── Sensitivity slider ───
function SensitivitySlider({ baseRevenue, onChange }: { baseRevenue: number; onChange: (val: number) => void }) {
  const [multiplier, setMultiplier] = useState(1);
  const marks = [0.5, 0.75, 1, 1.25, 1.5, 2];
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <TrendingUp className="h-3.5 w-3.5" />
      <span className="whitespace-nowrap">Revenue sensitivity</span>
      <div className="flex gap-1">
        {marks.map(m => (
          <button
            key={m}
            onClick={() => { setMultiplier(m); onChange(baseRevenue * m); }}
            className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
              multiplier === m ? 'bg-primary/20 border-primary/40 text-primary' : 'border-border/50 hover:bg-muted/50'
            }`}
          >
            {m === 1 ? 'Base' : `${(m * 100).toFixed(0)}%`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Tier row ───
function TierRow({
  tier,
  index,
  onUpdate,
  onDelete,
  amountReceived,
  fullyRecouped,
  currency,
}: {
  tier: RecoupmentTier;
  index: number;
  onUpdate: (id: string, updates: Partial<RecoupmentTier>) => void;
  onDelete: (id: string) => void;
  amountReceived?: number;
  fullyRecouped?: boolean;
  currency: string;
}) {
  const isPercentType = tier.tier_type === 'fee_pct' || tier.tier_type === 'corridor' || tier.tier_type === 'split';

  return (
    <div className="flex items-start gap-2 py-2 px-2 rounded-md border border-border/40 bg-card/50 group">
      <div className="flex flex-col items-center gap-0.5 pt-1 text-muted-foreground/50">
        <GripVertical className="h-3.5 w-3.5" />
        <span className="text-[10px] font-mono">{index + 1}</span>
      </div>

      <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_120px_100px_80px] gap-2">
        <Input
          value={tier.participant_name}
          onChange={e => onUpdate(tier.id, { participant_name: e.target.value })}
          placeholder="Participant name"
          className="h-7 text-xs bg-background/50"
        />
        <Select value={tier.tier_type} onValueChange={v => onUpdate(tier.id, { tier_type: v })}>
          <SelectTrigger className="h-7 text-xs bg-background/50"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIER_TYPES.map(t => (
              <SelectItem key={t.value} value={t.value}>
                <span className="text-xs">{t.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isPercentType ? (
          <div className="relative">
            <Input
              type="number"
              value={tier.percentage || ''}
              onChange={e => onUpdate(tier.id, { percentage: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              className="h-7 text-xs pr-6 bg-background/50"
            />
            <Percent className="absolute right-2 top-1.5 h-3.5 w-3.5 text-muted-foreground/50" />
          </div>
        ) : (
          <div className="relative">
            <Input
              type="number"
              value={tier.fixed_amount || ''}
              onChange={e => onUpdate(tier.id, { fixed_amount: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              className="h-7 text-xs pr-6 bg-background/50"
            />
            <DollarSign className="absolute right-2 top-1.5 h-3.5 w-3.5 text-muted-foreground/50" />
          </div>
        )}

        {/* Result badge */}
        <div className="flex items-center gap-1">
          {amountReceived !== undefined && (
            <Badge variant="outline" className={`text-[10px] ${fullyRecouped ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'}`}>
              {formatCurrency(amountReceived, currency)}
            </Badge>
          )}
        </div>
      </div>

      <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive/60 hover:text-destructive"
        onClick={() => onDelete(tier.id)}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ─── Chart ───
function WaterfallChart({ data, currency }: { data: { name: string; value: number; type: string }[]; currency: string }) {
  if (data.length === 0) return null;
  return (
    <div className="h-48 mt-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => formatCurrency(v, currency)} />
          <RechartsTooltip
            contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
            formatter={(value: number) => [formatCurrency(value, currency), 'Amount']}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={TIER_COLORS[entry.type] || 'hsl(var(--muted))'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Default template ───
const DEFAULT_TIERS: Partial<RecoupmentTier>[] = [
  { participant_name: 'Sales Agent Fee', tier_type: 'fee_pct', percentage: 15, tier_order: 0 },
  { participant_name: 'Distribution Expenses (P&A)', tier_type: 'expense', fixed_amount: 500000, tier_order: 1 },
  { participant_name: 'Senior Lender', tier_type: 'recoup', fixed_amount: 0, tier_order: 2 },
  { participant_name: 'Equity Investors', tier_type: 'recoup', fixed_amount: 0, tier_order: 3 },
  { participant_name: 'Producer Corridor', tier_type: 'corridor', percentage: 10, tier_order: 4 },
  { participant_name: 'Profit Split — Investors', tier_type: 'split', percentage: 50, tier_order: 5 },
  { participant_name: 'Profit Split — Producers', tier_type: 'split', percentage: 50, tier_order: 6 },
];

// ─── Main panel ───
export function RecoupmentWaterfallPanel({ projectId }: { projectId: string }) {
  const { scenarios, isLoading, addScenario, deleteScenario, updateScenario } = useRecoupmentScenarios(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeScenario = scenarios.find(s => s.id === selectedId) || scenarios[0] || null;

  const { tiers, addTier, updateTier, deleteTier } = useRecoupmentTiers(activeScenario?.id, projectId);

  const [sensitivityRevenue, setSensitivityRevenue] = useState<number | null>(null);
  const effectiveRevenue = sensitivityRevenue ?? (activeScenario?.total_revenue_estimate || 0);

  const waterfall = useMemo(() => calculateWaterfall(effectiveRevenue, tiers), [effectiveRevenue, tiers]);

  const chartData = useMemo(() => {
    return waterfall.tiers.map(r => ({
      name: r.tier.participant_name || 'Tier',
      value: r.amountReceived,
      type: r.tier.tier_type,
    }));
  }, [waterfall]);

  const currency = activeScenario?.currency || 'USD';

  // Reset sensitivity when scenario changes
  const handleSelectScenario = (id: string) => {
    setSelectedId(id);
    setSensitivityRevenue(null);
  };

  const handleCreateWithDefaults = async () => {
    const result = await addScenario.mutateAsync({ scenario_name: `Scenario ${scenarios.length + 1}` });
    if (result) {
      setSelectedId(result.id);
      // Add default tiers
      for (const t of DEFAULT_TIERS) {
        await addTier.mutateAsync(t);
      }
    }
  };

  if (isLoading) {
    return <div className="py-8 text-center text-xs text-muted-foreground">Loading recoupment data…</div>;
  }

  // Empty state
  if (scenarios.length === 0) {
    return (
      <Card className="p-6 text-center border-dashed border-2 border-border/50 bg-card/30">
        <ArrowDown className="h-8 w-8 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-sm font-medium text-foreground/80 mb-1">Recoupment Waterfall</p>
        <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">
          Model how revenue flows through distribution fees, lender recoupment, investor returns, and producer profit corridors. 
          This is where IFFY goes beyond budgeting — into the economics of your project.
        </p>
        <Button size="sm" onClick={handleCreateWithDefaults} disabled={addScenario.isPending}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Create Waterfall Scenario
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Scenario selector + revenue input */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Scenario</label>
          <div className="flex gap-1.5">
            {scenarios.map(s => (
              <button
                key={s.id}
                onClick={() => handleSelectScenario(s.id)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                  activeScenario?.id === s.id
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'border-border/50 text-muted-foreground hover:bg-muted/30'
                }`}
              >
                {s.scenario_name}
              </button>
            ))}
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={handleCreateWithDefaults}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="w-48">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">
            Total Revenue Estimate
          </label>
          <Input
            type="number"
            value={activeScenario?.total_revenue_estimate || ''}
            onChange={e => {
              if (activeScenario) {
                const val = parseFloat(e.target.value) || 0;
                updateScenario.mutate({ id: activeScenario.id, total_revenue_estimate: val });
                setSensitivityRevenue(null);
              }
            }}
            placeholder="e.g. 10000000"
            className="h-7 text-xs"
          />
        </div>

        <div className="w-20">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 block">Currency</label>
          <Select
            value={activeScenario?.currency || 'USD'}
            onValueChange={v => activeScenario && updateScenario.mutate({ id: activeScenario.id, currency: v })}
          >
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {['USD', 'GBP', 'EUR', 'CAD', 'AUD'].map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Sensitivity slider */}
      {activeScenario && activeScenario.total_revenue_estimate > 0 && (
        <SensitivitySlider
          baseRevenue={activeScenario.total_revenue_estimate}
          onChange={setSensitivityRevenue}
        />
      )}

      {/* Chart */}
      {chartData.length > 0 && effectiveRevenue > 0 && (
        <WaterfallChart data={chartData} currency={currency} />
      )}

      {/* Summary badges */}
      {effectiveRevenue > 0 && tiers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="text-[10px]">
            Revenue: {formatCurrency(effectiveRevenue, currency)}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
            Distributed: {formatCurrency(waterfall.totalDistributed, currency)}
          </Badge>
          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
            Remaining: {formatCurrency(waterfall.remainingRevenue, currency)}
          </Badge>
        </div>
      )}

      {/* Tier list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground/80">Waterfall Tiers</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-muted-foreground/50" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  Revenue flows top-down through each tier in order. Distribution fees come off gross, 
                  then expenses and recoupments are deducted, then corridors and splits divide what remains.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs"
            onClick={() => addTier.mutate({ participant_name: '', tier_type: 'recoup' })}>
            <Plus className="h-3 w-3 mr-1" /> Add Tier
          </Button>
        </div>

        {tiers.length === 0 && (
          <p className="text-xs text-muted-foreground/60 py-2 text-center">No tiers yet. Add tiers to model the waterfall.</p>
        )}

        {tiers.map((tier, i) => {
          const result = waterfall.tiers.find(r => r.tier.id === tier.id);
          return (
            <TierRow
              key={tier.id}
              tier={tier}
              index={i}
              onUpdate={(id, updates) => updateTier.mutate({ id, ...updates })}
              onDelete={id => deleteTier.mutate(id)}
              amountReceived={effectiveRevenue > 0 ? result?.amountReceived : undefined}
              fullyRecouped={result?.fullyRecouped}
              currency={currency}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 pt-1">
        {TIER_TYPES.map(t => (
          <div key={t.value} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: TIER_COLORS[t.value] }} />
            <span className="text-[10px] text-muted-foreground">{t.label}</span>
          </div>
        ))}
      </div>

      {/* Delete scenario */}
      {activeScenario && (
        <div className="flex justify-end pt-2">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive/60 hover:text-destructive"
            onClick={() => { deleteScenario.mutate(activeScenario.id); setSelectedId(null); }}>
            <Trash2 className="h-3 w-3 mr-1" /> Delete Scenario
          </Button>
        </div>
      )}
    </div>
  );
}
