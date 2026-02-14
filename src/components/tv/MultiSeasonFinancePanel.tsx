import { useState, useMemo } from 'react';
import { DollarSign, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface SeasonProjection {
  season: number;
  episodeCount: number;
  costPerEpisode: number;
  totalCost: number;
  projectedRevenue: number;
}

export function MultiSeasonFinancePanel({
  initialCostPerEp,
}: {
  initialCostPerEp?: number;
}) {
  const [seasons, setSeasons] = useState<SeasonProjection[]>([
    { season: 1, episodeCount: 8, costPerEpisode: initialCostPerEp || 1000000, totalCost: 0, projectedRevenue: 0 },
  ]);

  const updateSeason = (idx: number, field: keyof SeasonProjection, value: number) => {
    setSeasons(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const addSeason = () => {
    const last = seasons[seasons.length - 1];
    setSeasons(prev => [
      ...prev,
      {
        season: prev.length + 1,
        episodeCount: last.episodeCount,
        costPerEpisode: Math.round(last.costPerEpisode * 1.08), // 8% escalation
        totalCost: 0,
        projectedRevenue: Math.round((last.projectedRevenue || last.costPerEpisode * last.episodeCount) * 1.15),
      },
    ]);
  };

  const removeSeason = (idx: number) => {
    if (seasons.length <= 1) return;
    setSeasons(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, season: i + 1 })));
  };

  const computed = useMemo(() =>
    seasons.map(s => ({
      ...s,
      totalCost: s.episodeCount * s.costPerEpisode,
    })),
    [seasons]
  );

  const chartData = computed.map(s => ({
    name: `S${s.season}`,
    Cost: s.totalCost,
    Revenue: s.projectedRevenue,
    Margin: s.projectedRevenue - s.totalCost,
  }));

  const totalAllSeasons = computed.reduce((sum, s) => sum + s.totalCost, 0);
  const totalRevenue = computed.reduce((sum, s) => sum + s.projectedRevenue, 0);
  const fmt = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${(n / 1_000).toFixed(0)}K`;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground">Multi-Season Financial Projection</h4>
        </div>
        <Button size="sm" variant="outline" onClick={addSeason}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Season
        </Button>
      </div>

      {/* Season rows */}
      <div className="space-y-2">
        {computed.map((s, i) => (
          <div key={i} className="glass-card rounded-lg p-4 flex items-center gap-4 text-sm">
            <span className="font-display font-bold text-primary text-lg w-10 shrink-0">S{s.season}</span>
            <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Episodes</label>
                <Input
                  type="number"
                  value={s.episodeCount}
                  onChange={e => updateSeason(i, 'episodeCount', parseInt(e.target.value) || 1)}
                  className="h-9 text-sm font-medium"
                  min={1}
                  max={52}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Cost / Ep</label>
                <Input
                  type="number"
                  value={s.costPerEpisode}
                  onChange={e => updateSeason(i, 'costPerEpisode', parseInt(e.target.value) || 0)}
                  className="h-9 text-sm font-medium"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Total Cost</label>
                <p className="text-foreground font-semibold h-9 flex items-center">{fmt(s.totalCost)}</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Revenue Est.</label>
                <Input
                  type="number"
                  value={seasons[i].projectedRevenue}
                  onChange={e => updateSeason(i, 'projectedRevenue', parseInt(e.target.value) || 0)}
                  className="h-9 text-sm font-medium"
                />
              </div>
            </div>
            {seasons.length > 1 && (
              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeSeason(i)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="flex gap-4 text-sm">
        <div className="glass-card rounded-lg p-3 flex-1 text-center">
          <p className="text-xs text-muted-foreground">Total Investment</p>
          <p className="text-lg font-display font-bold text-foreground">{fmt(totalAllSeasons)}</p>
        </div>
        <div className="glass-card rounded-lg p-3 flex-1 text-center">
          <p className="text-xs text-muted-foreground">Total Revenue</p>
          <p className="text-lg font-display font-bold text-foreground">{fmt(totalRevenue)}</p>
        </div>
        <div className="glass-card rounded-lg p-3 flex-1 text-center">
          <p className="text-xs text-muted-foreground">Net Margin</p>
          <p className={`text-lg font-display font-bold ${totalRevenue - totalAllSeasons >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(totalRevenue - totalAllSeasons)}
          </p>
        </div>
      </div>

      {/* Chart */}
      {computed.length > 1 && (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(225 12% 18%)" />
              <XAxis dataKey="name" tick={{ fill: 'hsl(225 8% 50%)', fontSize: 11 }} />
              <YAxis tick={{ fill: 'hsl(225 8% 50%)', fontSize: 11 }} tickFormatter={v => fmt(v)} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(225 16% 10%)', border: '1px solid hsl(225 12% 18%)', borderRadius: '8px' }}
                labelStyle={{ color: 'hsl(40 6% 90%)' }}
                formatter={(v: number) => fmt(v)}
              />
              <Bar dataKey="Cost" fill="hsl(0 65% 45%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Revenue" fill="hsl(145 55% 45%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}