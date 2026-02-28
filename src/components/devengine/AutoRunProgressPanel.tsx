/**
 * AutoRunProgressPanel — Transparent pipeline progress with stage timeline,
 * approval gating, and pinned input controls.
 *
 * Shows: Stage X/Y, current action, completed stages with CI/GP scores, approval prompts.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, Circle, Loader2, Lock, Play, Pause,
  AlertTriangle, Square, RotateCcw,
} from 'lucide-react';
import type { AutoRunJob, AutoRunStep, AutoRunStageHistoryEntry } from '@/hooks/useAutoRun';
import { getLadderForFormat } from '@/lib/stages/registry';
import { getDeliverableLabel } from '@/lib/dev-os-config';
import { cn } from '@/lib/utils';

interface Props {
  job: AutoRunJob;
  steps: AutoRunStep[];
  format: string;
  isRunning: boolean;
  onPause: () => void;
  onResume: (followLatest?: boolean) => void;
  onStop: () => void;
  onApproveAndContinue?: () => void;
  onReject?: () => void;
  className?: string;
}

const STAGE_STATUS_ICON = {
  completed: CheckCircle2,
  in_progress: Loader2,
  failed: AlertTriangle,
  skipped: Circle,
} as const;

const STAGE_STATUS_COLOR = {
  completed: 'text-emerald-400',
  in_progress: 'text-primary animate-spin',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground/40',
} as const;

/** Derive the best CI/GP scores per stage from step history */
function deriveStageScores(steps: AutoRunStep[]): Record<string, { ci: number | null; gp: number | null }> {
  const scores: Record<string, { ci: number | null; gp: number | null }> = {};
  // Walk steps in order — last step with scores for a given document wins
  for (const step of steps) {
    if (step.ci != null || step.gp != null) {
      scores[step.document] = {
        ci: step.ci ?? scores[step.document]?.ci ?? null,
        gp: step.gp ?? scores[step.document]?.gp ?? null,
      };
    }
  }
  return scores;
}

function ScoreBadge({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  const color = value >= 90 ? 'text-emerald-400 border-emerald-500/30'
    : value >= 70 ? 'text-amber-400 border-amber-500/30'
    : 'text-destructive border-destructive/30';
  return (
    <Badge variant="outline" className={cn('text-[7px] px-1 py-0 font-mono tabular-nums', color)}>
      {label} {value}
    </Badge>
  );
}

export function AutoRunProgressPanel({
  job, steps, format, isRunning, onPause, onResume, onStop,
  onApproveAndContinue, onReject, className,
}: Props) {
  const pipeline = getLadderForFormat(format);
  const stageHistory: AutoRunStageHistoryEntry[] = job.stage_history || [];
  
  // Derive current stage index from current_document position in ladder (more reliable than DB field)
  const derivedStageIdx = useMemo(() => {
    const fromDoc = pipeline.indexOf(job.current_document as any);
    if (fromDoc >= 0) return fromDoc;
    return job.current_stage_index || 0;
  }, [pipeline, job.current_document, job.current_stage_index]);
  
  const currentStageIdx = derivedStageIdx;
  const totalStages = pipeline.length;
  const progressPct = totalStages > 0 ? Math.round((currentStageIdx / totalStages) * 100) : 0;

  const isAwaitingApproval = job.awaiting_approval && !!job.approval_required_for_doc_type;
  const isPaused = job.status === 'paused';
  const isStopped = job.status === 'stopped' || job.status === 'failed';

  // Derive scores from steps + job-level scores for current stage
  const stageScores = useMemo(() => {
    const scores = deriveStageScores(steps);
    // Supplement with job-level last_ci/last_gp for the current document
    if (job.current_document && (job.last_ci != null || job.last_gp != null)) {
      const existing = scores[job.current_document];
      scores[job.current_document] = {
        ci: job.last_ci ?? existing?.ci ?? null,
        gp: job.last_gp ?? existing?.gp ?? null,
      };
    }
    return scores;
  }, [steps, job.current_document, job.last_ci, job.last_gp]);

  return (
    <Card className={cn('border-primary/20', className)}>
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5 text-primary" />
            <CardTitle className="text-xs">Auto-Run Progress</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn('text-[8px] px-1.5 py-0', {
              'border-emerald-500/30 text-emerald-400': job.status === 'running',
              'border-amber-500/30 text-amber-400': isPaused || isAwaitingApproval,
              'border-destructive/30 text-destructive': isStopped,
              'border-emerald-500/30 text-emerald-400 bg-emerald-500/10': job.status === 'completed',
            })}>
              {isAwaitingApproval ? 'Awaiting Approval' : job.status}
            </Badge>
            <span className="text-[10px] font-mono text-muted-foreground">
              {currentStageIdx}/{totalStages}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="px-3 pb-3 space-y-2.5">
        {/* Progress bar */}
        <Progress value={progressPct} className="h-1.5" />

        {/* Current action message */}
        {job.last_ui_message && (
          <p className="text-[10px] text-muted-foreground italic">
            {job.last_ui_message}
          </p>
        )}

        {/* Pause reason */}
        {job.pause_reason && (isPaused || isAwaitingApproval) && (
          <div className="flex items-center gap-1.5 text-[10px] text-amber-400 bg-amber-500/5 rounded px-2 py-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>{job.pause_reason}</span>
          </div>
        )}

        {/* Approval gating prompt */}
        {isAwaitingApproval && (
          <div className="border border-amber-500/30 bg-amber-500/5 rounded-md p-2.5 space-y-2">
            <div className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-medium text-foreground">
                Approval required: {getDeliverableLabel(job.approval_required_for_doc_type || '', format)}
              </span>
            </div>
            {job.pending_version_id && (
              <p className="text-[9px] text-muted-foreground font-mono">
                Version: {job.pending_version_id.slice(0, 8)}…
              </p>
            )}
            <div className="flex items-center gap-1.5">
              {onApproveAndContinue && (
                <Button size="sm" className="h-6 text-[9px] gap-1" onClick={onApproveAndContinue}>
                  <CheckCircle2 className="h-3 w-3" /> Approve & Continue
                </Button>
              )}
              {onReject && (
                <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={onReject}>
                  <AlertTriangle className="h-3 w-3" /> Reject
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Stage timeline with scores */}
        <div className="space-y-0.5">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            Pipeline Stages
          </p>
          <div className="space-y-px">
            {pipeline.map((stage, i) => {
              const historyEntry = stageHistory.find(h => h.doc_type === stage);
              const isCurrent = i === currentStageIdx && job.status === 'running';
              const isCompleted = historyEntry?.status === 'completed';
              const isFailed = historyEntry?.status === 'failed';
              const isPast = i < currentStageIdx;
              const isApprovalStage = isAwaitingApproval && job.approval_required_for_doc_type === stage;

              let status: keyof typeof STAGE_STATUS_ICON = 'skipped';
              if (isCompleted || isPast) status = 'completed';
              else if (isCurrent) status = 'in_progress';
              else if (isFailed) status = 'failed';

              const Icon = STAGE_STATUS_ICON[status];
              const color = STAGE_STATUS_COLOR[status];

              // Scores for this stage
              const scores = stageScores[stage];
              // For current stage, prefer job's live scores
              const displayCi = isCurrent ? (job.last_ci ?? scores?.ci) : scores?.ci;
              const displayGp = isCurrent ? (job.last_gp ?? scores?.gp) : scores?.gp;
              const hasScores = displayCi != null || displayGp != null;

              return (
                <div
                  key={stage}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1 rounded text-[10px] transition-colors',
                    isCurrent && 'bg-primary/5 border border-primary/20',
                    isApprovalStage && 'bg-amber-500/5 border border-amber-500/20',
                  )}
                >
                  <Icon className={cn('h-3 w-3 shrink-0', color)} />
                  <span className={cn(
                    'flex-1 truncate',
                    isCompleted || isPast ? 'text-muted-foreground' : 'text-foreground',
                    isCurrent && 'font-medium text-primary',
                  )}>
                    {getDeliverableLabel(stage, format)}
                  </span>
                  {/* CI/GP scores */}
                  {hasScores && (status === 'completed' || isCurrent) && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <ScoreBadge label="CI" value={displayCi ?? null} />
                      <ScoreBadge label="GP" value={displayGp ?? null} />
                    </div>
                  )}
                  {isApprovalStage && (
                    <Badge variant="outline" className="text-[7px] px-1 py-0 border-amber-500/30 text-amber-400 shrink-0">
                      approval needed
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Pinned inputs summary */}
        {Object.keys(job.pinned_inputs || {}).length > 0 && (
          <div className="space-y-0.5">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
              Pinned Inputs
            </p>
            <div className="flex flex-wrap gap-1">
              {Object.entries(job.pinned_inputs).map(([docType, verId]) => (
                <Badge key={docType} variant="outline" className="text-[8px] px-1.5 py-0 gap-1">
                  {getDeliverableLabel(docType, format)}
                  <span className="font-mono text-muted-foreground">{String(verId).slice(0, 6)}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Control buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {job.status === 'running' && (
            <Button size="sm" variant="outline" className="h-6 text-[9px] gap-1" onClick={onPause}>
              <Pause className="h-3 w-3" /> Pause
            </Button>
          )}
          {(isPaused || isStopped) && !isAwaitingApproval && (
            <>
              <Button size="sm" className="h-6 text-[9px] gap-1" onClick={() => onResume(true)}>
                <Play className="h-3 w-3" /> Resume
              </Button>
              <Button size="sm" variant="destructive" className="h-6 text-[9px] gap-1" onClick={onStop}>
                <Square className="h-3 w-3" /> End
              </Button>
            </>
          )}
          {job.status === 'failed' && (
            <Button size="sm" className="h-6 text-[9px] gap-1" onClick={() => onResume(true)}>
              <RotateCcw className="h-3 w-3" /> Retry
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
