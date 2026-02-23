/**
 * StagedProgressBar — Reusable staged loading UI with step tracking and ETA.
 * Standard pattern for all long-running IFFY processes.
 */
import { cn } from '@/lib/utils';
import { Loader2, Check, Circle } from 'lucide-react';

export interface StagedProgressStage {
  label: string;
}

interface StagedProgressBarProps {
  title: string;
  stages: string[];
  currentStageIndex: number;
  progressPercent: number;
  etaSeconds?: number;
  detailMessage?: string;
  className?: string;
}

function formatEta(sec: number): string {
  if (sec <= 0) return 'finishing…';
  const s = Math.round(sec);
  if (s < 60) return `~${s}s remaining`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `~${m}m ${rem}s remaining` : `~${m}m remaining`;
}

export function StagedProgressBar({
  title,
  stages,
  currentStageIndex,
  progressPercent,
  etaSeconds,
  detailMessage,
  className,
}: StagedProgressBarProps) {
  const clampedPercent = Math.min(100, Math.max(0, progressPercent));
  const isComplete = currentStageIndex >= stages.length - 1 && clampedPercent >= 100;
  const isIndeterminate = clampedPercent <= 0 && !isComplete;

  return (
    <div className={cn('space-y-3 p-4 rounded-lg border border-border/50 bg-muted/5', className)}>
      {/* Title + ETA */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!isComplete && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          {isComplete && <Check className="h-3.5 w-3.5 text-emerald-500" />}
          <span className="text-xs font-medium text-foreground">{title}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {etaSeconds != null && etaSeconds > 0 && !isComplete && (
            <span>{formatEta(etaSeconds)}</span>
          )}
          <span className="tabular-nums font-medium text-foreground">{Math.round(clampedPercent)}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 rounded-full overflow-hidden bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            isComplete ? 'bg-emerald-500' : 'bg-primary',
            isIndeterminate && 'animate-pulse'
          )}
          style={{
            width: `${isIndeterminate ? 100 : clampedPercent}%`,
            ...(isIndeterminate ? { opacity: 0.4 } : {}),
          }}
        />
      </div>

      {/* Detail message */}
      {detailMessage && (
        <p className="text-[10px] text-muted-foreground">{detailMessage}</p>
      )}

      {/* Stage list */}
      <div className="space-y-1">
        {stages.map((stage, i) => {
          const isDone = i < currentStageIndex || (i === currentStageIndex && isComplete);
          const isCurrent = i === currentStageIndex && !isComplete;
          const isPending = i > currentStageIndex;

          return (
            <div key={i} className="flex items-center gap-2 text-[10px]">
              {isDone && <Check className="h-3 w-3 text-emerald-500 shrink-0" />}
              {isCurrent && <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />}
              {isPending && <Circle className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
              <span className={cn(
                isDone && 'text-muted-foreground line-through',
                isCurrent && 'text-foreground font-medium',
                isPending && 'text-muted-foreground/50',
              )}>
                {stage}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
