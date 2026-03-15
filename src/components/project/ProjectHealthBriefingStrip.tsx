/**
 * ProjectHealthBriefingStrip — Compact dashboard-level producer summary.
 * Repair-side only. Derives all metrics from existing NarrativeRepair rows.
 * Omits itself entirely when no terminal repairs exist.
 *
 * Metrics:
 *   - Active repairs: status in {pending, planned, approved, queued, in_progress}
 *   - Completed (30d): status === 'completed' with executed_at within 30 days
 *   - Failed (30d): status === 'failed' with executed_at within 30 days
 *   - 7d success rate: completed_7d / (completed_7d + failed_7d) × 100
 *   - Trend: improving if 7d rate > 30d rate + 5; degrading if < 30d rate − 5; else stable
 */

import { useMemo } from 'react';
import type { NarrativeRepair } from '@/hooks/useNarrativeRepairs';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';

interface Props {
  repairs: NarrativeRepair[] | null;
}

const ACTIVE_STATUSES = new Set(['pending', 'planned', 'approved', 'queued', 'in_progress']);
const TREND_THRESHOLD = 5; // percentage points

function deriveMetrics(repairs: NarrativeRepair[]) {
  const now = Date.now();
  const MS_30D = 30 * 24 * 60 * 60 * 1000;
  const MS_7D = 7 * 24 * 60 * 60 * 1000;

  let active = 0;
  let completed30d = 0;
  let failed30d = 0;
  let completed7d = 0;
  let failed7d = 0;
  let hasTerminal = false;

  for (const r of repairs) {
    if (ACTIVE_STATUSES.has(r.status)) {
      active++;
      continue;
    }

    // Terminal outcomes: completed or failed with an executed_at timestamp
    const ts = r.executed_at ? new Date(r.executed_at).getTime() : null;
    if (!ts) continue;

    if (r.status === 'completed') {
      hasTerminal = true;
      if (now - ts <= MS_30D) {
        completed30d++;
        if (now - ts <= MS_7D) completed7d++;
      }
    } else if (r.status === 'failed') {
      hasTerminal = true;
      if (now - ts <= MS_30D) {
        failed30d++;
        if (now - ts <= MS_7D) failed7d++;
      }
    }
  }

  const terminal30d = completed30d + failed30d;
  const terminal7d = completed7d + failed7d;
  const successRate30d = terminal30d > 0 ? (completed30d / terminal30d) * 100 : null;
  const successRate7d = terminal7d > 0 ? (completed7d / terminal7d) * 100 : null;

  let trendDirection: 'improving' | 'stable' | 'degrading' = 'stable';
  if (successRate7d !== null && successRate30d !== null) {
    const delta = successRate7d - successRate30d;
    if (delta > TREND_THRESHOLD) trendDirection = 'improving';
    else if (delta < -TREND_THRESHOLD) trendDirection = 'degrading';
  }

  return {
    active,
    completed30d,
    failed30d,
    successRate7d,
    trendDirection,
    hasTerminal,
  };
}

const TREND_DISPLAY: Record<string, { label: string; icon: typeof TrendingUp; className: string }> = {
  improving: { label: 'Improving', icon: TrendingUp,   className: 'text-emerald-600 dark:text-emerald-400' },
  stable:    { label: 'Stable',    icon: Minus,         className: 'text-muted-foreground' },
  degrading: { label: 'Degrading', icon: TrendingDown,  className: 'text-amber-600 dark:text-amber-400' },
};

export function ProjectHealthBriefingStrip({ repairs }: Props) {
  const metrics = useMemo(() => {
    if (!repairs || repairs.length === 0) return null;
    return deriveMetrics(repairs);
  }, [repairs]);

  // Omit entirely if no terminal executed repairs
  if (!metrics || !metrics.hasTerminal) return null;

  const trend = TREND_DISPLAY[metrics.trendDirection];
  const TrendIcon = trend.icon;

  return (
    <div className="flex items-center gap-4 border-b border-border/40 bg-muted/20 px-6 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Activity className="h-3 w-3" />
        <span className="font-medium text-foreground/80">Health</span>
      </div>

      <div className="flex items-center gap-3 text-muted-foreground">
        <span>
          Active{' '}
          <span className="font-semibold text-foreground">{metrics.active}</span>
        </span>
        <span className="text-border">·</span>
        <span>
          30d ✓{' '}
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{metrics.completed30d}</span>
        </span>
        <span className="text-border">·</span>
        <span>
          30d ✗{' '}
          <span className="font-semibold text-destructive">{metrics.failed30d}</span>
        </span>
        <span className="text-border">·</span>
        <span>
          7d success{' '}
          <span className="font-semibold text-foreground">
            {metrics.successRate7d !== null ? `${Math.round(metrics.successRate7d)}%` : '—'}
          </span>
        </span>
        <span className="text-border">·</span>
        <span className={`flex items-center gap-0.5 ${trend.className}`}>
          <TrendIcon className="h-3 w-3" />
          {trend.label}
        </span>
      </div>
    </div>
  );
}
