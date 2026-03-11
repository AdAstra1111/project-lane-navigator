/**
 * RewriteExecutionPanel — Producer-facing selective regeneration execution UI.
 * Lets users trigger dry-runs and real execution, then inspect results.
 * Fail-closed: surfaces real abort reasons; never fabricates success.
 */

import { useState } from 'react';
import { useSelectiveRegenerationPlan } from '@/hooks/useSelectiveRegenerationPlan';
import { useExecuteSelectiveRegeneration, type RegenExecutionResult } from '@/hooks/useExecuteSelectiveRegeneration';
import { useSceneSluglines, type SluglineMap } from '@/hooks/useSceneSluglines';
import { useSceneVersionDiff } from '@/hooks/useSceneVersionDiff';
import { SceneRewriteDiffViewer } from '@/components/project/SceneRewriteDiffViewer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Play,
  FlaskConical,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  GitCompare,
} from 'lucide-react';

interface Props {
  projectId: string | undefined;
}

const INITIAL_SHOW = 8;

/* ── Status config ── */
const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: typeof CheckCircle2 }> = {
  completed:       { label: 'Completed',       variant: 'default',     icon: CheckCircle2 },
  dry_run:         { label: 'Dry Run',         variant: 'secondary',   icon: FlaskConical },
  partial_failure: { label: 'Partial Failure', variant: 'outline',     icon: AlertTriangle },
  failed:          { label: 'Failed',          variant: 'destructive', icon: XCircle },
  abort:           { label: 'Aborted',         variant: 'destructive', icon: XCircle },
};

function sceneLabel(key: string, sluglines: SluglineMap): string {
  const slug = sluglines.get(key);
  return slug ? `${key} — ${slug}` : key;
}

export function RewriteExecutionPanel({ projectId }: Props) {
  const { data: plan, isLoading: planLoading } = useSelectiveRegenerationPlan(projectId);
  const { execute, isExecuting, result, error, reset } = useExecuteSelectiveRegeneration(projectId);
  const { data: sluglines } = useSceneSluglines(projectId);
  const slugMap = sluglines ?? new Map<string, string>();
  const diffHook = useSceneVersionDiff(projectId);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [showAllFailed, setShowAllFailed] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffSceneIndex, setDiffSceneIndex] = useState(0);

  const completedKeysForDiff = result?.completed_scene_keys ?? [];

  const handleViewChanges = (sceneKey: string) => {
    const idx = completedKeysForDiff.indexOf(sceneKey);
    setDiffSceneIndex(idx >= 0 ? idx : 0);
    setDiffOpen(true);
    diffHook.loadDiff(sceneKey);
  };

  const handleDiffNavigate = (sceneKey: string) => {
    const idx = completedKeysForDiff.indexOf(sceneKey);
    setDiffSceneIndex(idx >= 0 ? idx : 0);
    diffHook.loadDiff(sceneKey);
  };

  // Loading
  if (planLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-10 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  // Fail-closed: no plan data → render nothing
  if (!plan) return null;

  const scope = plan.recommended_scope ?? 'no_risk';
  const canExecute = scope !== 'no_risk' && !!projectId && !isExecuting;

  const handleDryRun = async () => {
    reset();
    await execute(true);
  };

  const handleExecuteClick = () => {
    setConfirmOpen(true);
  };

  const handleConfirmExecute = async () => {
    setConfirmOpen(false);
    reset();
    await execute(false);
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Play className="h-4 w-4 text-muted-foreground" />
          Rewrite Execution
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Controls ── */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            disabled={!canExecute}
            onClick={handleDryRun}
          >
            {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            Dry Run
          </Button>
          <Button
            size="sm"
            disabled={!canExecute}
            onClick={handleExecuteClick}
          >
            {isExecuting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Execute Repair
          </Button>
          {scope === 'no_risk' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-emerald-500" />
              No regeneration needed
            </span>
          )}
        </div>

        {/* ── Error state ── */}
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* ── Execution Result ── */}
        {result && <ExecutionResultView result={result} slugMap={slugMap} showAllCompleted={showAllCompleted} setShowAllCompleted={setShowAllCompleted} showAllFailed={showAllFailed} setShowAllFailed={setShowAllFailed} onViewChanges={handleViewChanges} />}

        {/* ── Confirmation Dialog ── */}
        <ConfirmExecutionDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          onConfirm={handleConfirmExecute}
          plan={plan}
        />

        {/* ── Scene Rewrite Diff Viewer ── */}
        <SceneRewriteDiffViewer
          open={diffOpen}
          onOpenChange={(v) => { setDiffOpen(v); if (!v) diffHook.clear(); }}
          data={diffHook.data}
          loading={diffHook.loading}
          error={diffHook.error}
          sceneKeys={completedKeysForDiff}
          currentIndex={diffSceneIndex}
          onNavigate={handleDiffNavigate}
        />
      </CardContent>
    </Card>
  );
}

/* ── Confirmation Dialog ── */

function ConfirmExecutionDialog({
  open,
  onOpenChange,
  onConfirm,
  plan,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => void;
  plan: NonNullable<ReturnType<typeof useSelectiveRegenerationPlan>['data']>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Confirm Selective Regeneration</DialogTitle>
          <DialogDescription>
            This will regenerate impacted scenes. Review the scope below before proceeding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Scope</span>
            <Badge variant="outline" className="text-xs">{plan.recommended_scope}</Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Impacted scenes</span>
            <span className="font-medium">{plan.impacted_scene_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Source units</span>
            <span className="font-medium">{plan.source_units?.length ?? 0}</span>
          </div>
          {(plan.direct_axes?.length > 0 || plan.propagated_axes?.length > 0) && (
            <div className="flex justify-between items-start">
              <span className="text-muted-foreground">Axes</span>
              <div className="flex flex-wrap gap-1 justify-end max-w-[60%]">
                {plan.direct_axes?.map((a) => (
                  <Badge key={a} variant="destructive" className="text-[10px]">{a}</Badge>
                ))}
                {plan.propagated_axes?.map((a) => (
                  <Badge key={a} variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">{a}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onConfirm}>
            <Play className="h-3.5 w-3.5" />
            Execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Execution Result View ── */

function ExecutionResultView({
  result,
  slugMap,
  showAllCompleted,
  setShowAllCompleted,
  showAllFailed,
  setShowAllFailed,
  onViewChanges,
}: {
  result: RegenExecutionResult;
  slugMap: SluglineMap;
  showAllCompleted: boolean;
  setShowAllCompleted: (v: boolean) => void;
  showAllFailed: boolean;
  setShowAllFailed: (v: boolean) => void;
  onViewChanges?: (sceneKey: string) => void;
}) {
  const status = result.status ?? (result.ok ? 'completed' : 'failed');
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.failed;
  const StatusIcon = cfg.icon;

  // NDG risk delta
  const pre = result.ndg_pre_at_risk_count;
  const post = result.ndg_post_at_risk_count;
  let ndgDelta: 'improved' | 'unchanged' | 'degraded' | null = null;
  if (pre != null && post != null) {
    ndgDelta = post < pre ? 'improved' : post === pre ? 'unchanged' : 'degraded';
  }

  // Abort state
  if (status === 'abort' && result.abort_reason) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 space-y-1">
        <div className="flex items-center gap-2 text-sm font-medium text-destructive">
          <XCircle className="h-4 w-4" />
          Execution Aborted
        </div>
        <p className="text-xs text-destructive/80">{formatAbortReason(result.abort_reason)}</p>
      </div>
    );
  }

  const completedKeys = result.completed_scene_keys ?? [];
  const failedKeys = result.failed_scene_keys ?? [];
  const visibleCompleted = showAllCompleted ? completedKeys : completedKeys.slice(0, INITIAL_SHOW);
  const visibleFailed = showAllFailed ? failedKeys : failedKeys.slice(0, INITIAL_SHOW);

  return (
    <div className="space-y-3">
      {/* Status + Run ID */}
      <div className="flex items-center justify-between rounded-md border border-border/40 bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusIcon className={`h-4 w-4 ${status === 'completed' ? 'text-emerald-500' : status === 'partial_failure' ? 'text-amber-500' : 'text-destructive'}`} />
          <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
        </div>
        {result.run_id && (
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[140px]">{result.run_id}</span>
        )}
      </div>

      {/* Counts */}
      <div className="grid grid-cols-2 gap-2">
        <MetricTile label="Completed" value={result.completed_scene_count ?? 0} className="text-emerald-600 dark:text-emerald-400" />
        <MetricTile label="Failed" value={result.failed_scene_count ?? 0} className={result.failed_scene_count ? 'text-destructive' : 'text-muted-foreground'} />
      </div>

      {/* NDG / NUE Outcome Strip */}
      <div className="rounded-md border border-border/40 bg-muted/20 px-3 py-2 space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Outcome</h4>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {ndgDelta && (
            <span className="flex items-center gap-1">
              <ArrowDownUp className="h-3 w-3" />
              NDG Risk:
              <span className={ndgDelta === 'improved' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : ndgDelta === 'degraded' ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                {ndgDelta} ({pre} → {post})
              </span>
            </span>
          )}
          {result.ndg_validation_status && (
            <span>
              Validation: <span className={result.ndg_validation_status === 'passed' ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-amber-600 dark:text-amber-400 font-medium'}>{result.ndg_validation_status}</span>
            </span>
          )}
          <span>
            NUE Revalidated: <span className="font-medium">{result.nue_revalidated ? 'Yes' : 'No'}</span>
          </span>
          {result.aligned_unit_count != null && (
            <span>
              Aligned Units: <span className="font-medium">{result.aligned_unit_count}</span>
            </span>
          )}
        </div>
      </div>

      {/* Completed Scenes */}
      {completedKeys.length > 0 && (
        <SceneKeyList
          title="Completed Scenes"
          keys={visibleCompleted}
          total={completedKeys.length}
          slugMap={slugMap}
          showAll={showAllCompleted}
          onToggle={() => setShowAllCompleted(!showAllCompleted)}
          variant="success"
          onViewChanges={onViewChanges}
        />
      )}

      {/* Failed Scenes */}
      {failedKeys.length > 0 && (
        <SceneKeyList
          title="Failed Scenes"
          keys={visibleFailed}
          total={failedKeys.length}
          slugMap={slugMap}
          showAll={showAllFailed}
          onToggle={() => setShowAllFailed(!showAllFailed)}
          variant="destructive"
        />
      )}

      {/* Diagnostics */}
      {result.diagnostics && (
        <p className="text-xs text-muted-foreground border-t border-border/30 pt-2">{result.diagnostics}</p>
      )}
    </div>
  );
}

/* ── Metric Tile ── */

function MetricTile({ label, value, className = '' }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-md border border-border/30 bg-muted/20 px-3 py-2 text-center">
      <div className={`text-lg font-semibold ${className}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );
}

/* ── Scene Key List ── */

function SceneKeyList({
  title,
  keys,
  total,
  slugMap,
  showAll,
  onToggle,
  variant,
  onViewChanges,
}: {
  title: string;
  keys: string[];
  total: number;
  slugMap: SluglineMap;
  showAll: boolean;
  onToggle: () => void;
  variant: 'success' | 'destructive';
  onViewChanges?: (sceneKey: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="space-y-1">
        {keys.map((k) => (
          <div key={k} className="flex items-center rounded-md border border-border/30 bg-muted/20 px-2.5 py-1.5 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 mr-2 ${variant === 'success' ? 'bg-emerald-500' : 'bg-destructive'}`} />
            <span className="text-foreground truncate flex-1">{sceneLabel(k, slugMap)}</span>
            {onViewChanges && variant === 'success' && (
              <button
                onClick={() => onViewChanges(k)}
                className="flex items-center gap-1 text-[10px] text-primary hover:underline shrink-0 ml-2"
              >
                <GitCompare className="h-3 w-3" />
                View Changes
              </button>
            )}
          </div>
        ))}
      </div>
      {total > INITIAL_SHOW && (
        <button onClick={onToggle} className="flex items-center gap-1 text-xs text-primary hover:underline pt-0.5">
          {showAll ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {showAll ? 'Show less' : `Show all ${total}`}
        </button>
      )}
    </div>
  );
}

/* ── Abort reason formatting ── */

function formatAbortReason(reason: string): string {
  const map: Record<string, string> = {
    no_risk: 'Story structure currently aligned — no regeneration required.',
    no_scenes: 'No scenes identified for regeneration.',
    propagated_only: 'Only propagated impact detected — no direct regeneration targets.',
    already_running: 'A regeneration run is already in progress for this project.',
    execution_locked: 'Execution is currently locked. Please try again later.',
  };
  return map[reason] ?? reason;
}
