/**
 * ScreenplayIntakeBanner — Shows intake run status + per-stage progress
 * for screenplay-imported projects. Renders nothing if no intake run exists.
 * All state derived from persisted screenplay_intake_runs / stage_runs.
 */

import { motion } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, RotateCcw, Clock, FileText, XCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useScreenplayIntakeRun, type IntakeStageRecord } from '@/hooks/useScreenplayIntakeRun';
import { formatDistanceToNow } from 'date-fns';

interface ScreenplayIntakeBannerProps {
  projectId: string | undefined;
}

const STAGE_LABELS: Record<string, string> = {
  upload:         'Script uploaded',
  ingest:         'Text extracted',
  project_create: 'Project created',
  scene_extract:  'Scene graph extracted',
  nit_dialogue:   'Dialogue links synced',
  role_classify:  'Scene roles classified',
  spine_sync:     'Spine links mapped',
  binding_derive: 'Bindings derived',
};

function StageStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
    case 'skipped':
      return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />;
    default: // pending
      return <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />;
  }
}

function RunStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; style: string }> = {
    running: { label: 'In Progress', style: 'border-primary/40 text-primary' },
    done:    { label: 'Complete',    style: 'border-emerald-500/40 text-emerald-400' },
    partial: { label: 'Partial',     style: 'border-amber-500/40 text-amber-400' },
    failed:  { label: 'Failed',      style: 'border-destructive/40 text-destructive' },
  };
  const c = config[status] ?? config.failed;
  return (
    <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-4', c.style)}>
      {c.label}
    </Badge>
  );
}

function StageRow({
  stage,
  retryingStage,
  onRetry,
}: {
  stage: IntakeStageRecord;
  retryingStage: string | null;
  onRetry: (key: string) => void;
}) {
  const label = STAGE_LABELS[stage.stage_key] ?? stage.label;
  const isRetrying = retryingStage === stage.stage_key;
  const showRetry = stage.status === 'failed' && stage.retryable && !isRetrying;

  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <StageStatusIcon status={isRetrying ? 'running' : stage.status} />
      <span className={cn(
        'flex-1',
        stage.status === 'done' && 'text-muted-foreground',
        stage.status === 'running' && 'text-foreground font-medium',
        stage.status === 'failed' && 'text-destructive font-medium',
        stage.status === 'pending' && 'text-muted-foreground/50',
        stage.status === 'skipped' && 'text-muted-foreground/50',
      )}>
        {label}
      </span>

      {stage.status === 'failed' && stage.error && (
        <span className="text-[10px] text-destructive/70 max-w-[180px] truncate" title={stage.error}>
          {stage.error}
        </span>
      )}

      {showRetry && (
        <Button
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-[10px] gap-1"
          onClick={() => onRetry(stage.stage_key)}
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </Button>
      )}

      {isRetrying && (
        <span className="text-[10px] text-primary flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> retrying…
        </span>
      )}
    </div>
  );
}

export function ScreenplayIntakeBanner({ projectId }: ScreenplayIntakeBannerProps) {
  const {
    latestRun,
    stages,
    isLoading,
    retryingStage,
    retryStage,
  } = useScreenplayIntakeRun(projectId);

  // Fail closed
  if (!projectId || isLoading || !latestRun) return null;

  const doneCount = stages.filter(s => s.status === 'done' || s.status === 'skipped').length;
  const total = stages.length;

  const initiatedAgo = latestRun.initiated_at
    ? formatDistanceToNow(new Date(latestRun.initiated_at), { addSuffix: true })
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-border/50 bg-card p-4 space-y-3 mt-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Screenplay Import</span>
          <RunStatusBadge status={latestRun.status} />
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          {initiatedAgo && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {initiatedAgo}
            </span>
          )}
          <span className="tabular-nums font-medium text-foreground">
            {doneCount} / {total} stages
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full overflow-hidden bg-muted">
        <motion.div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            latestRun.status === 'done' ? 'bg-emerald-500' :
            latestRun.status === 'failed' ? 'bg-destructive' : 'bg-primary',
          )}
          initial={{ width: 0 }}
          animate={{ width: `${total > 0 ? Math.round((doneCount / total) * 100) : 0}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>

      {/* Stage list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0">
        {stages.map(stage => (
          <StageRow
            key={stage.stage_key}
            stage={stage}
            retryingStage={retryingStage}
            onRetry={retryStage}
          />
        ))}
      </div>

      {/* Footer warning for incomplete runs */}
      {latestRun.status !== 'done' && (
        <p className="text-[10px] text-amber-400/80 border-t border-border/40 pt-2">
          Import is not fully complete — some downstream features may be unavailable.
        </p>
      )}
    </motion.div>
  );
}
