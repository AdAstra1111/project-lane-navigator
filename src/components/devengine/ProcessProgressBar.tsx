import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

interface ProcessProgressBarProps {
  percent: number;
  actualPercent?: number;
  label?: string;
  phase?: string;
  etaMs?: number | null;
  status?: 'idle' | 'working' | 'warn' | 'error' | 'success';
  size?: 'sm' | 'md';
}

function formatEta(ms: number): string {
  if (ms <= 0) return '';
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `~${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `~${mins}m ${remSecs}s` : `~${mins}m`;
}

const STATUS_COLORS: Record<string, string> = {
  idle: 'bg-muted',
  working: 'bg-primary',
  warn: 'bg-amber-500',
  error: 'bg-destructive',
  success: 'bg-green-600',
};

const PHASE_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  probing: 'secondary',
  enqueuing: 'secondary',
  queued: 'outline',
  processing_scene: 'default',
  processing_chunk: 'default',
  assembling: 'secondary',
  writing_version: 'secondary',
  complete: 'default',
  error: 'destructive',
};

export function ProcessProgressBar({
  percent, actualPercent, label, phase, etaMs, status = 'working', size = 'sm',
}: ProcessProgressBarProps) {
  const displayPercent = actualPercent ?? Math.round(percent);
  const barHeight = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {status === 'working' && <Loader2 className="h-3 w-3 animate-spin shrink-0 text-primary" />}
          {phase && (
            <Badge variant={PHASE_VARIANTS[phase] || 'outline'} className="text-[10px] px-1.5 py-0 h-4 shrink-0">
              {phase.replace(/_/g, ' ')}
            </Badge>
          )}
          {label && <span className="text-muted-foreground truncate">{label}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
          {etaMs != null && etaMs > 0 && (
            <span className="text-[10px]">ETA: {formatEta(etaMs)}</span>
          )}
          <span className="tabular-nums font-medium text-foreground">{displayPercent}%</span>
        </div>
      </div>
      <div className={cn('w-full rounded-full overflow-hidden', barHeight, 'bg-muted')}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', STATUS_COLORS[status] || 'bg-primary')}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}
