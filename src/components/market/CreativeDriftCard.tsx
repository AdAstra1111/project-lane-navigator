/**
 * Creative Health card — shows benchmark, feel, BPM, drift metrics, health status.
 */
import { motion } from 'framer-motion';
import { Activity, HeartPulse, AlertTriangle, CheckCircle2, TrendingDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STYLE_BENCHMARK_LABELS, PACING_FEEL_LABELS } from '@/lib/rulesets/styleBenchmarks';
import { useProjectCreativeDrift, type HealthStatus } from '@/hooks/useProjectCreativeDrift';
import { formatDistanceToNow } from 'date-fns';

const HEALTH_CONFIG: Record<HealthStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  healthy:  { label: 'Healthy',  color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: CheckCircle2 },
  drifting: { label: 'Drifting', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',    icon: TrendingDown },
  at_risk:  { label: 'At Risk',  color: 'bg-red-500/15 text-red-400 border-red-500/30',           icon: AlertTriangle },
};

function MetricBar({ label, value, max = 1, warn }: { label: string; value: number; max?: number; warn?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  const isWarn = warn != null && value > warn;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-mono', isWarn ? 'text-amber-400' : 'text-foreground')}>{value.toFixed(2)}</span>
      </div>
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', isWarn ? 'bg-amber-400' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface Props {
  projectId: string;
  lane: string;
}

export function CreativeDriftCard({ projectId, lane }: Props) {
  const { data, isLoading } = useProjectCreativeDrift(projectId, lane);

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-4 animate-pulse">
        <div className="h-5 w-40 bg-muted rounded mb-3" />
        <div className="h-16 bg-muted rounded" />
      </div>
    );
  }

  if (!data) return null;

  const { benchmark, feel, benchmarkDefaults, drift, health } = data;
  const cfg = HEALTH_CONFIG[health];
  const HealthIcon = cfg.icon;
  const benchLabel = STYLE_BENCHMARK_LABELS[benchmark]?.name || benchmark;
  const feelLabel = PACING_FEEL_LABELS[feel] || feel;
  const bpm = benchmarkDefaults.beats_per_minute;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card rounded-xl p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-primary" />
          <h4 className="font-display font-semibold text-foreground text-sm">Creative Health</h4>
        </div>
        <Badge className={cn('text-[10px] px-2 py-0.5 border flex items-center gap-1', cfg.color)}>
          <HealthIcon className="h-3 w-3" />
          {cfg.label}
        </Badge>
      </div>

      {/* Benchmark + Feel + BPM */}
      <div className="flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">Benchmark</span>
          <span className="text-xs font-medium text-foreground">{benchLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">Feel</span>
          <span className="text-xs font-medium text-foreground">{feelLabel}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg px-2.5 py-1.5">
          <span className="text-[10px] text-muted-foreground">Target BPM</span>
          <span className="text-xs font-mono font-medium text-foreground">{bpm.target}</span>
          <span className="text-[9px] text-muted-foreground">({bpm.min}–{bpm.max})</span>
        </div>
      </div>

      {/* Drift Metrics */}
      {drift ? (
        <div className="space-y-2">
          <MetricBar label="Melodrama" value={drift.melodrama_score} warn={0.62} />
          <MetricBar label="Nuance" value={drift.nuance_score} />
          <MetricBar label="Similarity Risk" value={drift.similarity_risk} warn={0.55} />

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className={cn(
                'text-xs font-mono font-bold',
                drift.final_pass ? 'text-emerald-400' : 'text-red-400'
              )}>
                {(drift.final_score * 100).toFixed(0)}%
              </span>
              <span className="text-[10px] text-muted-foreground">
                gate {drift.final_pass ? 'passed' : 'failed'}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(drift.created_at), { addSuffix: true })}
            </span>
          </div>

          {drift.hard_failures.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {drift.hard_failures.map(f => (
                <Badge key={f} variant="destructive" className="text-[9px] px-1.5 py-0">
                  {f}
                </Badge>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-3 text-center">
          <Activity className="h-4 w-4 mx-auto mb-1 opacity-50" />
          No quality analysis runs yet. Generate content to see drift metrics.
        </div>
      )}
    </motion.div>
  );
}
