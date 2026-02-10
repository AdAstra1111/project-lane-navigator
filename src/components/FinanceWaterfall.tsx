import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { DollarSign } from 'lucide-react';
import type { ProjectFinanceScenario } from '@/hooks/useProjectAttachments';

interface FinanceWaterfallProps {
  scenarios: ProjectFinanceScenario[];
}

function parseAmount(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

const SOURCE_COLORS: Record<string, string> = {
  'Equity': 'hsl(var(--primary))',
  'Pre-Sales': 'hsl(210, 70%, 55%)',
  'Incentives': 'hsl(145, 60%, 45%)',
  'Gap': 'hsl(35, 90%, 55%)',
  'Other': 'hsl(280, 50%, 55%)',
};

interface WaterfallBar {
  name: string;
  value: number;
  start: number;
  fill: string;
}

export function FinanceWaterfall({ scenarios }: FinanceWaterfallProps) {
  const scenario = scenarios[0] ?? null;

  const data = useMemo(() => {
    if (!scenario) return null;
    const equity = parseAmount(scenario.equity_amount);
    const presales = parseAmount(scenario.presales_amount);
    const incentives = parseAmount(scenario.incentive_amount);
    const gap = parseAmount(scenario.gap_amount);
    const other = parseAmount(scenario.other_sources);
    const total = parseAmount(scenario.total_budget);

    const sources: { name: string; value: number }[] = [
      { name: 'Equity', value: equity },
      { name: 'Pre-Sales', value: presales },
      { name: 'Incentives', value: incentives },
      { name: 'Gap', value: gap },
      { name: 'Other', value: other },
    ].filter(s => s.value > 0);

    let cumulative = 0;
    const bars: WaterfallBar[] = sources.map(s => {
      const bar: WaterfallBar = {
        name: s.name,
        value: s.value,
        start: cumulative,
        fill: SOURCE_COLORS[s.name] || 'hsl(var(--muted-foreground))',
      };
      cumulative += s.value;
      return bar;
    });

    return { bars, total, funded: cumulative };
  }, [scenario]);

  if (!data || data.bars.length === 0) return null;

  const gapPct = data.total > 0 ? Math.round(((data.total - data.funded) / data.total) * 100) : 0;
  const fundedPct = data.total > 0 ? Math.round((data.funded / data.total) * 100) : 0;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h3 className="font-display font-semibold text-foreground">Finance Waterfall</h3>
        </div>
        <span className="text-xs text-muted-foreground">{scenario.scenario_name}</span>
      </div>

      {/* Summary bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Funded: {formatCurrency(data.funded)} ({fundedPct}%)</span>
          <span>Budget: {formatCurrency(data.total)}</span>
        </div>
        <div className="h-3 rounded-full bg-muted overflow-hidden flex">
          {data.bars.map((bar) => (
            <div
              key={bar.name}
              className="h-full transition-all duration-500"
              style={{
                width: data.total > 0 ? `${(bar.value / data.total) * 100}%` : '0%',
                backgroundColor: bar.fill,
              }}
              title={`${bar.name}: ${formatCurrency(bar.value)}`}
            />
          ))}
        </div>
        {gapPct > 0 && (
          <p className="text-xs text-amber-400">
            {formatCurrency(data.total - data.funded)} gap remaining ({gapPct}%)
          </p>
        )}
      </div>

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.bars} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatCurrency(v)}
              width={60}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--popover))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'hsl(var(--popover-foreground))',
              }}
              formatter={(value: number) => [formatCurrency(value), 'Amount']}
            />
            {data.total > 0 && (
              <ReferenceLine
                y={data.total}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="3 3"
                label={{ value: 'Budget', fill: 'hsl(var(--muted-foreground))', fontSize: 10, position: 'right' }}
              />
            )}
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.bars.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {data.bars.map((bar) => (
          <div key={bar.name} className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: bar.fill }} />
            <span className="text-muted-foreground">{bar.name}</span>
            <span className="text-foreground font-medium">{formatCurrency(bar.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
