/**
 * AutoRunProgressInfo — Live elapsed time, step rate, ETA, and stage timing
 * for an active auto-run job.
 */
import { useState, useEffect, useMemo } from 'react';
import { Clock, Gauge, Timer, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';

interface AutoRunProgressInfoProps {
  job: AutoRunJob;
  steps: AutoRunStep[];
  isRunning: boolean;
  totalPipelineStages: number;
  completedStages: number;
}

function formatDuration(seconds: number): string {
  if (seconds < 0) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`;
}

function formatEta(seconds: number): string {
  if (seconds <= 0) return 'finishing…';
  return `~${formatDuration(seconds)}`;
}

export function AutoRunProgressInfo({
  job, steps, isRunning, totalPipelineStages, completedStages,
}: AutoRunProgressInfoProps) {
  // Live elapsed counter
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isRunning && job.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, job.status]);

  const stats = useMemo(() => {
    const jobStart = new Date(job.created_at).getTime();
    const elapsed = (now - jobStart) / 1000;

    // Step rate from actual timestamps
    const sortedSteps = [...steps].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    const stepCount = job.step_count || sortedSteps.length;

    // Average seconds per step
    let avgStepSec = 0;
    if (sortedSteps.length >= 2) {
      const first = new Date(sortedSteps[0].created_at).getTime();
      const last = new Date(sortedSteps[sortedSteps.length - 1].created_at).getTime();
      const spanSec = (last - first) / 1000;
      avgStepSec = spanSec / Math.max(1, sortedSteps.length - 1);
    } else if (stepCount > 0 && elapsed > 0) {
      avgStepSec = elapsed / stepCount;
    }

    // Rate: steps per minute
    const stepsPerMin = avgStepSec > 0 ? 60 / avgStepSec : 0;

    // ETA based on remaining steps
    const remainingSteps = Math.max(0, job.max_total_steps - stepCount);
    const etaSec = avgStepSec > 0 ? remainingSteps * avgStepSec : -1;

    // Current stage elapsed
    const stageSteps = sortedSteps.filter(s => s.document === job.current_document);
    let stageElapsed = 0;
    if (stageSteps.length > 0) {
      const stageStart = new Date(stageSteps[0].created_at).getTime();
      stageElapsed = (now - stageStart) / 1000;
    }

    return {
      elapsed,
      stepCount,
      avgStepSec,
      stepsPerMin,
      remainingSteps,
      etaSec,
      stageElapsed,
      stageStepCount: stageSteps.length,
    };
  }, [now, job, steps]);

  const showEta = stats.etaSec > 0 && stats.stepCount >= 2;

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px]">
      {/* Elapsed */}
      <div className="flex items-center gap-1.5">
        <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Elapsed</span>
        <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
          {formatDuration(stats.elapsed)}
        </span>
      </div>

      {/* Step rate */}
      <div className="flex items-center gap-1.5">
        <Gauge className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Rate</span>
        <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
          {stats.stepsPerMin > 0 ? `${stats.stepsPerMin.toFixed(1)}/min` : '—'}
        </span>
      </div>

      {/* ETA */}
      <div className="flex items-center gap-1.5">
        <Timer className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">ETA</span>
        <span className={cn(
          'ml-auto font-mono font-medium tabular-nums',
          showEta ? 'text-foreground' : 'text-muted-foreground',
        )}>
          {showEta ? formatEta(stats.etaSec) : '—'}
        </span>
      </div>

      {/* Stage progress */}
      <div className="flex items-center gap-1.5">
        <TrendingUp className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-muted-foreground">Stage</span>
        <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
          {stats.stageStepCount > 0
            ? `${stats.stageStepCount} steps · ${formatDuration(stats.stageElapsed)}`
            : '—'
          }
        </span>
      </div>
    </div>
  );
}
