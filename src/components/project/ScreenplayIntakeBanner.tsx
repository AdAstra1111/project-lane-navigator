/**
 * ScreenplayIntakeBanner — Shows intake run status + per-stage progress
 * for screenplay-imported projects. Renders nothing if no intake run exists.
 * All state derived from persisted screenplay_intake_runs / stage_runs.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, RotateCcw, Clock, FileText, XCircle, MinusCircle, AlertTriangle, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useScreenplayIntakeRun, type IntakeStageRecord, type SceneGraphHealth } from '@/hooks/useScreenplayIntakeRun';
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
    case 'rebuild_required':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
    default: // pending
      return <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30 shrink-0" />;
  }
}

function RunStatusBadge({ status, rebuildRequired }: { status: string; rebuildRequired: boolean }) {
  if (rebuildRequired) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-amber-500/40 text-amber-400">
        Rebuild Required
      </Badge>
    );
  }
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
  isRebuildTarget,
  rebuilding,
  onRebuild,
  rebuildSceneCount,
}: {
  stage: IntakeStageRecord;
  retryingStage: string | null;
  onRetry: (key: string) => void;
  isRebuildTarget: boolean;
  rebuilding: boolean;
  onRebuild: () => void;
  rebuildSceneCount: number | null;
}) {
  const label = STAGE_LABELS[stage.stage_key] ?? stage.label;
  const isRetrying = retryingStage === stage.stage_key;
  const displayStatus = isRebuildTarget ? 'rebuild_required' : (isRetrying ? 'running' : stage.status);
  const showRetry = stage.status === 'failed' && stage.retryable && !isRetrying && !isRebuildTarget;

  return (
    <div className="flex items-center gap-2 text-xs py-1">
      <StageStatusIcon status={displayStatus} />
      <span className={cn(
        'flex-1',
        stage.status === 'done' && 'text-muted-foreground',
        stage.status === 'running' && 'text-foreground font-medium',
        stage.status === 'failed' && 'text-destructive font-medium',
        stage.status === 'pending' && 'text-muted-foreground/50',
        stage.status === 'skipped' && !isRebuildTarget && 'text-muted-foreground/50',
        isRebuildTarget && 'text-amber-400 font-medium',
      )}>
        {label}
        {isRebuildTarget && rebuildSceneCount != null && (
          <span className="text-[10px] text-amber-400/70 ml-1">
            ({rebuildSceneCount} existing scenes)
          </span>
        )}
      </span>

      {stage.status === 'failed' && stage.error && !isRebuildTarget && (
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

      {isRebuildTarget && !rebuilding && (
        <ConfirmDialog
          title="Rebuild Scene Graph"
          description="This will delete the current scene graph and regenerate scenes from the screenplay. Downstream structures will be recalculated automatically. This action cannot be undone."
          confirmLabel="Rebuild Scene Graph"
          variant="destructive"
          onConfirm={onRebuild}
        >
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] gap-1 text-amber-400 hover:text-amber-300"
          >
            <RotateCcw className="h-3 w-3" />
            Rebuild
          </Button>
        </ConfirmDialog>
      )}

      {isRebuildTarget && rebuilding && (
        <span className="text-[10px] text-primary flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> rebuilding…
        </span>
      )}
    </div>
  );
}

function GraphHealthAdvisory({ health }: { health: SceneGraphHealth | null }) {
  if (!health) return null;

  const config: Record<string, { icon: React.ReactNode; label: string; message: string; style: string }> = {
    POPULATED_GRAPH: {
      icon:    <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />,
      label:   'Healthy Scene Graph',
      message: 'Scene graph is structurally complete.',
      style:   'border-emerald-500/20 bg-emerald-500/5 text-emerald-400/90',
    },
    PARTIAL_GRAPH: {
      icon:    <ShieldAlert className="h-3.5 w-3.5 text-amber-500 shrink-0" />,
      label:   'Partial Scene Graph',
      message: 'Scene graph appears incomplete. Rebuild is recommended.',
      style:   'border-amber-500/20 bg-amber-500/5 text-amber-400/90',
    },
    EMPTY_GRAPH: {
      icon:    <Shield className="h-3.5 w-3.5 text-muted-foreground shrink-0" />,
      label:   'Empty Scene Graph',
      message: 'Scene graph has not been generated yet.',
      style:   'border-border/40 bg-muted/30 text-muted-foreground',
    },
  };

  const c = config[health.state];
  if (!c) return null;

  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2', c.style)}>
      {c.icon}
      <div className="text-[11px] space-y-0.5">
        <p className="font-medium">{c.label}
          {health.scene_count > 0 && (
            <span className="font-normal ml-1 opacity-70">({health.scene_count} scenes)</span>
          )}
        </p>
        <p className="opacity-70">{c.message}</p>
        {health.state === 'PARTIAL_GRAPH' && health.signals.length > 0 && (
          <p className="opacity-50 text-[10px] font-mono">{health.signals.join(', ')}</p>
        )}
      </div>
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
    rebuilding,
    rebuildRequired,
    rebuildSceneCount,
    rebuildSceneGraph,
    graphHealth,
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
          <RunStatusBadge status={latestRun.status} rebuildRequired={rebuildRequired} />
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

      {/* Rebuild required message */}
      {rebuildRequired && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
          <div className="text-[11px] text-amber-400/90 space-y-0.5">
            <p className="font-medium">Scene extraction cannot be retried because a scene graph already exists.</p>
            <p className="text-amber-400/70">Use rebuild to regenerate the scene graph from the screenplay.</p>
          </div>
        </div>
      )}

      {/* Scene graph health advisory */}
      <GraphHealthAdvisory health={graphHealth} />

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full overflow-hidden bg-muted">
        <motion.div
          className={cn(
            'h-full rounded-full transition-all duration-500 ease-out',
            latestRun.status === 'done' ? 'bg-emerald-500' :
            rebuildRequired ? 'bg-amber-500' :
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
            isRebuildTarget={rebuildRequired && stage.stage_key === 'scene_extract'}
            rebuilding={rebuilding}
            onRebuild={rebuildSceneGraph}
            rebuildSceneCount={rebuildSceneCount}
          />
        ))}
      </div>

      {/* Footer warning for incomplete runs */}
      {latestRun.status !== 'done' && !rebuildRequired && (
        <p className="text-[10px] text-amber-400/80 border-t border-border/40 pt-2">
          Import is not fully complete — some downstream features may be unavailable.
        </p>
      )}
    </motion.div>
  );
}
