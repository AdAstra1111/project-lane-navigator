/**
 * LookbookPipelineProgress — Shows pipeline stage + requirement-level progress.
 */
import { cn } from '@/lib/utils';
import { Loader2, Check, Circle, AlertTriangle } from 'lucide-react';
import type { PipelineProgress, RequirementProgress } from '@/lib/lookbook/pipeline/types';
import { PipelineStage } from '@/lib/lookbook/pipeline/types';

const STAGE_LABELS: Record<string, string> = {
  MODE_SELECTION: 'Mode',
  NARRATIVE_EXTRACTION: 'Narrative',
  SLOT_PLANNING: 'Planning',
  IDENTITY_BINDING: 'Identity',
  INVENTORY: 'Inventory',
  GAP_ANALYSIS: 'Gaps',
  RESOLUTION: 'Resolution',
  GENERATION: 'Generation',
  ELECTION: 'Election',
  ASSEMBLY: 'Assembly',
  QA: 'QA',
};

const STAGE_ORDER = Object.values(PipelineStage);

interface Props {
  progress: PipelineProgress | null;
  className?: string;
}

export function LookbookPipelineProgress({ progress, className }: Props) {
  if (!progress) return null;

  const currentIdx = STAGE_ORDER.indexOf(progress.currentStage);

  return (
    <div className={cn('space-y-3 p-4 rounded-lg border border-border/50 bg-muted/5', className)}>
      {/* Stage stepper */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {STAGE_ORDER.map((stage, i) => {
          const isDone = i < currentIdx || (i === currentIdx && progress.stageStatus === 'complete');
          const isCurrent = i === currentIdx && progress.stageStatus !== 'complete';
          const isWarning = i === currentIdx && progress.stageStatus === 'warning';

          return (
            <div key={stage} className="flex items-center gap-1 shrink-0">
              {i > 0 && <div className={cn('w-3 h-px', isDone ? 'bg-emerald-500' : 'bg-border')} />}
              <div className="flex items-center gap-1">
                {isDone && <Check className="h-3 w-3 text-emerald-500" />}
                {isCurrent && !isWarning && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                {isWarning && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                {!isDone && !isCurrent && !isWarning && <Circle className="h-3 w-3 text-muted-foreground/30" />}
                <span className={cn(
                  'text-[10px]',
                  isDone && 'text-muted-foreground',
                  isCurrent && 'text-foreground font-medium',
                  isWarning && 'text-amber-500 font-medium',
                  !isDone && !isCurrent && !isWarning && 'text-muted-foreground/50',
                )}>
                  {STAGE_LABELS[stage] || stage}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Current message */}
      <div className="flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        <span className="text-xs text-foreground">{progress.message}</span>
        {progress.percent != null && (
          <span className="text-[10px] text-muted-foreground tabular-nums ml-auto">{Math.round(progress.percent)}%</span>
        )}
      </div>

      {/* Progress bar */}
      {progress.percent != null && (
        <div className="w-full h-1.5 rounded-full overflow-hidden bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, progress.percent)}%` }}
          />
        </div>
      )}

      {/* Requirement-level progress */}
      {progress.requirements && progress.requirements.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground font-medium">Requirements</p>
          <div className="grid gap-1 max-h-32 overflow-y-auto">
            {progress.requirements.map(req => (
              <RequirementRow key={req.id} req={req} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RequirementRow({ req }: { req: RequirementProgress }) {
  const statusIcon = {
    pending: <Circle className="h-2.5 w-2.5 text-muted-foreground/30" />,
    planning: <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-400" />,
    generating: <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />,
    generated: <Check className="h-2.5 w-2.5 text-blue-400" />,
    scoring: <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-400" />,
    selected: <Check className="h-2.5 w-2.5 text-emerald-400" />,
    complete: <Check className="h-2.5 w-2.5 text-emerald-500" />,
    blocked: <AlertTriangle className="h-2.5 w-2.5 text-red-400" />,
  }[req.status];

  return (
    <div className="flex items-center gap-2 text-[10px]">
      {statusIcon}
      <span className={cn(
        'truncate',
        req.status === 'complete' && 'text-muted-foreground',
        req.status === 'blocked' && 'text-red-400',
        req.status !== 'complete' && req.status !== 'blocked' && 'text-foreground',
      )}>
        {req.label}
      </span>
      {req.generatedCount > 0 && (
        <span className="text-muted-foreground ml-auto shrink-0">
          {req.generatedCount} gen
          {req.selectedCount > 0 && ` / ${req.selectedCount} sel`}
        </span>
      )}
      {req.blockingReason && (
        <span className="text-red-400 ml-auto shrink-0 truncate max-w-[120px]">{req.blockingReason}</span>
      )}
    </div>
  );
}
