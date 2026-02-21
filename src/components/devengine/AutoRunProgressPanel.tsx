/**
 * AutoRunProgressPanel — Transparent pipeline progress with stage timeline,
 * approval gating, and pinned input controls.
 *
 * Shows: Stage X/Y, current action, completed stages, approval prompts.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2, Circle, Loader2, Lock, Play, Pause,
  AlertTriangle, ArrowRight, Square, RotateCcw,
} from 'lucide-react';
import type { AutoRunJob, AutoRunStageHistoryEntry } from '@/hooks/useAutoRun';
import { getLadderForFormat } from '@/lib/stages/registry';
import { getDeliverableLabel } from '@/lib/dev-os-config';
import { cn } from '@/lib/utils';

interface Props {
  job: AutoRunJob;
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

export function AutoRunProgressPanel({
  job, format, isRunning, onPause, onResume, onStop,
  onApproveAndContinue, onReject, className,
}: Props) {
  const pipeline = getLadderForFormat(format);
  const stageHistory: AutoRunStageHistoryEntry[] = job.stage_history || [];
  const currentStageIdx = job.current_stage_index || 0;
  const totalStages = pipeline.length;
  const progressPct = totalStages > 0 ? Math.round((currentStageIdx / totalStages) * 100) : 0;

  const isAwaitingApproval = job.awaiting_approval && !!job.approval_required_for_doc_type;
  const isPaused = job.status === 'paused';
  const isStopped = job.status === 'stopped' || job.status === 'failed';

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

        {/* Stage timeline */}
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
                    'flex-1',
                    isCompleted || isPast ? 'text-muted-foreground line-through' : 'text-foreground',
                    isCurrent && 'font-medium text-primary',
                  )}>
                    {getDeliverableLabel(stage, format)}
                  </span>
                  {isApprovalStage && (
                    <Badge variant="outline" className="text-[7px] px-1 py-0 border-amber-500/30 text-amber-400">
                      approval needed
                    </Badge>
                  )}
                  {historyEntry?.base_version_id && (
                    <span className="text-[8px] font-mono text-muted-foreground/50">
                      {historyEntry.base_version_id.slice(0, 6)}
                    </span>
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
