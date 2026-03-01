/**
 * AutopilotProgress — Stage-list progress component for DevSeed Autopilot.
 * Shows each pipeline stage with Running/Done/Error status and resume capability.
 */
import { CheckCircle, XCircle, Loader2, Clock, Play, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface StageState {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  updated_at: string | null;
  doc_id?: string | null;
  version_id?: string | null;
  notes?: string | null;
  error?: string | null;
}

export interface AutopilotState {
  run_id: string;
  status: 'idle' | 'running' | 'paused' | 'complete' | 'error';
  started_at: string;
  updated_at: string;
  options: {
    apply_seed_intel_pack: boolean;
    regen_foundation: boolean;
    generate_primary_script: boolean;
  };
  stages: {
    apply_seed_intel_pack: StageState;
    regen_foundation: StageState;
    generate_primary_script: StageState;
  };
  last_error?: { message: string; stage: string; at: string } | null;
  pitch_idea_id?: string;
}

const STAGE_LABELS: Record<string, string> = {
  apply_seed_intel_pack: 'Apply Seed Intelligence',
  regen_foundation: 'Regenerate Foundation Docs',
  generate_primary_script: 'Generate Primary Script',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="h-3.5 w-3.5 text-muted-foreground" />,
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />,
  done: <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />,
  error: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />,
};

interface Props {
  autopilot: AutopilotState;
  onResume?: () => void;
  isResuming?: boolean;
  className?: string;
}

export function AutopilotProgress({ autopilot, onResume, isResuming, className }: Props) {
  const { stages, status, last_error } = autopilot;
  const stageNames = Object.keys(stages) as Array<keyof typeof stages>;

  const isRunning = status === 'running';
  const isDone = status === 'complete';
  const hasError = status === 'error' || stageNames.some(s => stages[s].status === 'error');
  const isPaused = status === 'paused';
  const canResume = (hasError || isPaused) && !isResuming;

  return (
    <div className={`rounded-lg border border-border/40 overflow-hidden ${className || ''}`}>
      {/* Header */}
      <div className="px-3 py-2 bg-muted/30 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          {isDone && <CheckCircle className="h-4 w-4 text-emerald-500" />}
          {hasError && !isRunning && <XCircle className="h-4 w-4 text-destructive" />}
          {isPaused && !hasError && <Clock className="h-4 w-4 text-muted-foreground" />}
          <span className="text-xs font-semibold text-foreground">
            {isDone ? 'Autopilot Complete' : isRunning ? 'Autopilot Running…' : hasError ? 'Autopilot Error' : isPaused ? 'Autopilot Paused' : 'Autopilot'}
          </span>
        </div>
        {canResume && onResume && (
          <Button
            variant="outline"
            size="sm"
            onClick={onResume}
            disabled={isResuming}
            className="h-7 text-xs gap-1"
          >
            {isResuming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Resume
          </Button>
        )}
      </div>

      {/* Stage list */}
      <div className="divide-y divide-border/20">
        {stageNames.map(stageName => {
          const stage = stages[stageName];
          return (
            <div key={stageName} className="flex items-center gap-2 px-3 py-2">
              {STATUS_ICON[stage.status] || STATUS_ICON.pending}
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-foreground">
                  {STAGE_LABELS[stageName] || stageName}
                </span>
                {stage.notes && stage.status === 'done' && (
                  <span className="text-[10px] text-muted-foreground ml-1.5">
                    — {stage.notes}
                  </span>
                )}
                {stage.error && (
                  <p className="text-[10px] text-destructive truncate mt-0.5">
                    {stage.error}
                  </p>
                )}
              </div>
              <Badge
                variant={stage.status === 'done' ? 'default' : stage.status === 'error' ? 'destructive' : 'secondary'}
                className="text-[10px] h-5 shrink-0"
              >
                {stage.status}
              </Badge>
            </div>
          );
        })}
      </div>

      {/* Last error */}
      {last_error && (
        <div className="px-3 py-2 bg-destructive/5 border-t border-destructive/20">
          <p className="text-[10px] text-destructive">
            <strong>Error in {STAGE_LABELS[last_error.stage] || last_error.stage}:</strong>{' '}
            {last_error.message}
          </p>
        </div>
      )}
    </div>
  );
}
