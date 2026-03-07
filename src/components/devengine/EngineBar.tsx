/**
 * EngineBar — Single canonical source-of-truth UI for engine execution.
 * Always visible at the top of the Dev Engine page.
 *
 * Shows: status pill, stage label, lite metrics, primary controls,
 * execution mode selector, and advanced toggle.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Pause, Square, Play, Loader2, Settings2,
  Activity, Target, TrendingDown, Zap,
} from 'lucide-react';
import type { AutoRunJob } from '@/hooks/useAutoRun';
import type { UIMode } from '@/lib/mode';

// ── Execution Mode ──
export type ExecutionMode = 'manual' | 'assisted' | 'full_autopilot';

const EXECUTION_MODE_LABELS: Record<ExecutionMode, string> = {
  manual: 'Manual',
  assisted: 'Assisted',
  full_autopilot: 'Full Autopilot',
};

const EXECUTION_MODE_DESC: Record<ExecutionMode, string> = {
  manual: 'Pause on every gate',
  assisted: 'Auto-decide recommended, pause on blockers',
  full_autopilot: 'Auto-decide ALL including blockers',
};

// ── Status mapping ──
function deriveStatus(job: AutoRunJob | null): 'idle' | 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'stopped' {
  if (!job) return 'idle';
  if (job.awaiting_approval) return 'blocked';
  if (job.status === 'paused') return 'paused';
  if (job.status === 'running' || job.status === 'queued') return 'running';
  if (job.status === 'completed') return 'completed';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'stopped') return 'stopped';
  return 'idle';
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'bg-muted text-muted-foreground border-border' },
  running: { label: 'Running', className: 'bg-primary/15 text-primary border-primary/30 animate-pulse' },
  paused: { label: 'Paused', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  blocked: { label: 'Blocked', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  completed: { label: 'Complete', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  failed: { label: 'Failed', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  stopped: { label: 'Stopped', className: 'bg-muted text-muted-foreground border-border' },
};

function formatDocType(dt: string) {
  return dt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Derive execution mode from job flags ──
export function deriveExecutionMode(job: AutoRunJob | null): ExecutionMode {
  if (!job) return 'manual';
  // Check the mode field first for 'assisted', then fall back to allow_defaults
  if ((job as any).execution_mode === 'assisted') return 'assisted';
  if (job.allow_defaults) return 'full_autopilot';
  return 'manual';
}

// ── Props ──
interface EngineBarProps {
  job: AutoRunJob | null;
  isRunning: boolean;
  uiMode: UIMode;
  onToggleMode: () => void;
  executionMode: ExecutionMode;
  onSetExecutionMode: (mode: ExecutionMode) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function EngineBar({
  job, isRunning, uiMode, onToggleMode,
  executionMode, onSetExecutionMode,
  onPause, onResume, onStop,
}: EngineBarProps) {
  const status = deriveStatus(job);
  const statusCfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;

  const ci = job?.last_confidence ?? job?.last_ci ?? null;
  const readiness = job?.last_readiness ?? null;
  const gap = job?.last_gap ?? null;
  const stageLabel = job
    ? `${formatDocType(job.current_document)} → ${formatDocType(job.target_document)}`
    : null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm px-4 py-2.5 shadow-sm">
      {/* Status pill */}
      <Badge variant="outline" className={`text-[10px] font-semibold px-2.5 py-0.5 ${statusCfg.className}`}>
        {status === 'running' && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
        {statusCfg.label}
      </Badge>

      {/* Stage label */}
      {stageLabel && (
        <span className="text-[11px] text-muted-foreground font-medium hidden sm:inline">
          {stageLabel}
        </span>
      )}

      {/* Step counter */}
      {job && (
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 font-mono">
          Step {job.step_count}/{job.max_total_steps}
        </Badge>
      )}

      {/* Lite metrics strip */}
      <div className="flex items-center gap-3 ml-auto">
        {ci !== null && (
          <div className="flex items-center gap-1 text-[10px]" title="Confidence Index">
            <Activity className="h-3 w-3 text-primary" />
            <span className="font-semibold text-foreground">{ci}</span>
          </div>
        )}
        {readiness !== null && (
          <div className="flex items-center gap-1 text-[10px]" title="Readiness">
            <Target className="h-3 w-3 text-emerald-500" />
            <span className="font-semibold text-foreground">{readiness}</span>
          </div>
        )}
        {gap !== null && (
          <div className="flex items-center gap-1 text-[10px]" title="Gap">
            <TrendingDown className="h-3 w-3 text-amber-500" />
            <span className="font-semibold text-foreground">{gap}</span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border/60 hidden sm:block" />

      {/* Execution mode selector */}
      <Select value={executionMode} onValueChange={(v) => onSetExecutionMode(v as ExecutionMode)}>
        <SelectTrigger className="h-7 text-[10px] w-[130px] border-border/50">
          <Zap className="h-3 w-3 mr-1" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(EXECUTION_MODE_LABELS) as ExecutionMode[]).map(m => (
            <SelectItem key={m} value={m} className="text-xs">
              <div>
                <span className="font-medium">{EXECUTION_MODE_LABELS[m]}</span>
                <span className="text-muted-foreground ml-1.5">— {EXECUTION_MODE_DESC[m]}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Primary controls */}
      <div className="flex items-center gap-1">
        {(status === 'running') && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onPause} title="Pause">
            <Pause className="h-3.5 w-3.5" />
          </Button>
        )}
        {(status === 'paused' || status === 'blocked' || status === 'stopped') && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onResume} title="Resume">
            <Play className="h-3.5 w-3.5" />
          </Button>
        )}
        {(status === 'running' || status === 'paused') && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onStop} title="Stop">
            <Square className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Advanced toggle */}
      <Button
        variant={uiMode === 'advanced' ? 'default' : 'outline'}
        size="sm"
        className="h-7 text-[10px] px-2.5 gap-1"
        onClick={onToggleMode}
      >
        <Settings2 className="h-3 w-3" />
        {uiMode === 'advanced' ? 'Advanced' : 'Clean'}
      </Button>
    </div>
  );
}
