/**
 * InlineProcessBar — Reusable inline progress bar for any long-running workflow.
 * Shows stage, description, optional percentage, and status.
 */
import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { ProcessStatus } from '@/lib/processing/types';

interface InlineProcessBarProps {
  status: ProcessStatus;
  /** Current stage label */
  stage?: string;
  /** Brief explanation of current work */
  description?: string;
  /** 0–100 if truly known */
  percent?: number;
  /** e.g. "3 / 12" */
  processed?: number;
  total?: number;
  /** Error message */
  error?: string;
  className?: string;
}

const BAR_COLORS: Record<ProcessStatus, string> = {
  queued: 'bg-muted-foreground/30',
  running: 'bg-primary',
  waiting: 'bg-amber-500',
  completed: 'bg-emerald-500',
  failed: 'bg-destructive',
};

const STATUS_ICON: Record<ProcessStatus, React.ElementType> = {
  queued: Clock,
  running: Loader2,
  waiting: Clock,
  completed: CheckCircle2,
  failed: XCircle,
};

export function InlineProcessBar({
  status, stage, description, percent, processed, total, error, className,
}: InlineProcessBarProps) {
  const Icon = STATUS_ICON[status] || Loader2;
  const isActive = status === 'running' || status === 'waiting';
  const isIndeterminate = isActive && (percent == null || percent <= 0);
  const displayPercent = percent != null ? Math.min(100, Math.max(0, Math.round(percent))) : null;

  return (
    <div className={cn('space-y-1.5', className)}>
      {/* Top row: icon + stage + counts */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Icon className={cn(
            'h-3 w-3 shrink-0',
            status === 'running' && 'animate-spin text-primary',
            status === 'completed' && 'text-emerald-500',
            status === 'failed' && 'text-destructive',
            status === 'queued' && 'text-muted-foreground',
            status === 'waiting' && 'text-amber-500',
          )} />
          {stage && (
            <span className="font-medium text-foreground truncate">{stage}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
          {total != null && processed != null && (
            <span className="text-[10px] tabular-nums">{processed}/{total}</span>
          )}
          {displayPercent != null && (
            <span className="tabular-nums font-medium text-foreground text-[11px]">{displayPercent}%</span>
          )}
        </div>
      </div>

      {/* Description */}
      {(description || error) && (
        <p className={cn(
          'text-[10px] leading-relaxed',
          error ? 'text-destructive' : 'text-muted-foreground',
        )}>
          {error || description}
        </p>
      )}

      {/* Bar */}
      <div className="w-full h-1.5 rounded-full overflow-hidden bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            BAR_COLORS[status],
            isIndeterminate && 'animate-pulse',
          )}
          style={{
            width: `${isIndeterminate ? 100 : (displayPercent ?? 0)}%`,
            ...(isIndeterminate ? { opacity: 0.35 } : {}),
          }}
        />
      </div>
    </div>
  );
}
