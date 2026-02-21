import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectStateGraph, ConfidenceBands } from '@/hooks/useStateGraph';
import { Zap, Film, HardHat, DollarSign, TrendingUp, Target } from 'lucide-react';

interface Props {
  stateGraph: ProjectStateGraph;
}

function MetricBar({ label, value, max = 10, color }: { label: string; value: number; max?: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{typeof value === 'number' ? value.toFixed(1) : value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BandRow({ label, band, format }: { label: string; band: { low: number; mid: number; high: number }; format: (v: number) => string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5 font-mono">
        <span className="text-muted-foreground">{format(band.low)}</span>
        <span className="text-foreground font-semibold">{format(band.mid)}</span>
        <span className="text-muted-foreground">{format(band.high)}</span>
      </div>
    </div>
  );
}

export function StateGraphOverview({ stateGraph }: Props) {
  const { creative_state: c, execution_state: e, production_state: p, finance_state: f, revenue_state: r, confidence_bands: bands } = stateGraph;

  const layers = [
    {
      title: 'Creative', icon: Film, color: 'bg-primary',
      metrics: [
        { label: 'Structural Density', value: c.structural_density },
        { label: 'Character Density', value: c.character_density },
        { label: 'Hook Intensity', value: c.hook_intensity },
      ],
      summary: `${c.format} · ${c.runtime_minutes}min · ${c.tone_classification} · ${c.behaviour_mode}`,
    },
    {
      title: 'Execution', icon: Zap, color: 'bg-accent',
      metrics: [
        { label: 'Coverage Density', value: e.coverage_density },
        { label: 'Movement Intensity', value: e.movement_intensity },
        { label: 'VFX/Stunt Density', value: e.vfx_stunt_density },
        { label: 'Editorial Fragility', value: e.editorial_fragility },
      ],
      summary: `${e.setup_count} setups · ${(e.night_exterior_ratio * 100).toFixed(0)}% night ext · ${e.equipment_load_multiplier.toFixed(2)}× equip`,
    },
    {
      title: 'Production', icon: HardHat, color: 'bg-secondary',
      metrics: [
        { label: 'Schedule Compression', value: p.schedule_compression_risk },
        { label: 'Location Clustering', value: p.location_clustering },
        { label: 'Weather Exposure', value: p.weather_exposure },
      ],
      summary: `${p.estimated_shoot_days} days · ${p.crew_intensity_band} crew · ${(p.overtime_probability * 100).toFixed(0)}% OT prob`,
    },
    {
      title: 'Finance', icon: DollarSign, color: 'bg-muted-foreground',
      metrics: [
        { label: 'Budget Elasticity', value: f.budget_elasticity },
        { label: 'Drift Sensitivity', value: f.drift_sensitivity },
        { label: 'Capital Stack Stress', value: f.capital_stack_stress },
      ],
      summary: `${f.budget_band} · $${(f.budget_estimate / 1_000_000).toFixed(1)}M est · ${f.insurance_load_proxy.toFixed(1)} ins load`,
    },
    {
      title: 'Revenue', icon: TrendingUp, color: 'bg-destructive',
      metrics: [
        { label: 'Downside Exposure', value: r.downside_exposure },
        { label: 'Upside Potential', value: r.upside_potential },
        { label: 'Platform Appetite', value: r.platform_appetite_strength },
      ],
      summary: `${r.confidence_score}% confidence · ROI bands: ${r.roi_probability_bands.low}–${r.roi_probability_bands.high}`,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Confidence Bands Summary */}
      {bands && (
        <Card className="border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" /> Confidence Bands
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <BandRow
              label="Budget Range"
              band={bands.budget}
              format={(v: number) => `$${(v / 1_000_000).toFixed(1)}M`}
            />
            <BandRow
              label="Shoot Days"
              band={bands.shoot_days}
              format={(v: number) => `${v}d`}
            />
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
              <span className="text-muted-foreground">Overall Confidence</span>
              <span className="font-mono font-semibold text-primary">{bands.confidence}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5-layer overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {layers.map(layer => {
          const Icon = layer.icon;
          return (
            <Card key={layer.title} className="border-border/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {layer.title}
                </CardTitle>
                <p className="text-[10px] text-muted-foreground leading-tight">{layer.summary}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                {layer.metrics.map(m => (
                  <MetricBar key={m.label} label={m.label} value={m.value} color={layer.color} />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
