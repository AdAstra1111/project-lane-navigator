import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Play, RotateCcw, Package, Square, AlertCircle, CheckCircle2, Clock, Layers, Eye, AlertTriangle, Bug, Target } from 'lucide-react';
import { useSceneRewritePipeline, type PreviewResult } from '@/hooks/useSceneRewritePipeline';
import { ProcessProgressBar } from './ProcessProgressBar';
import { ActivityTimeline } from './ActivityTimeline';

interface SceneRewritePanelProps {
  projectId: string;
  documentId: string;
  versionId: string;
  approvedNotes: any[];
  protectItems: string[];
  onComplete?: (newVersionId: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'done': return <Badge variant="default" className="bg-green-600 text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />Done</Badge>;
    case 'running': return <Badge variant="default" className="bg-blue-600 text-xs animate-pulse"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Running</Badge>;
    case 'failed': return <Badge variant="destructive" className="text-xs"><AlertCircle className="h-3 w-3 mr-1" />Failed</Badge>;
    case 'queued': return <Badge variant="secondary" className="text-xs"><Clock className="h-3 w-3 mr-1" />Queued</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

const MODE_OPTIONS = [
  { value: 'auto' as const, label: 'Auto' },
  { value: 'scene' as const, label: 'Scene' },
  { value: 'chunk' as const, label: 'Chunk' },
];

export function SceneRewritePanel({
  projectId, documentId, versionId, approvedNotes, protectItems, onComplete,
}: SceneRewritePanelProps) {
  const pipeline = useSceneRewritePipeline(projectId);
  const [initialized, setInitialized] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const startGuardRef = useRef(false);

  useEffect(() => {
    if (!initialized && versionId) {
      pipeline.loadStatus(versionId).then(() => setInitialized(true));
    }
  }, [versionId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pipeline.mode === 'complete' && pipeline.newVersionId && onComplete) {
      onComplete(pipeline.newVersionId);
    }
  }, [pipeline.mode, pipeline.newVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStart = async () => {
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    try {
      // Use scope plan if available
      const targetScenes = pipeline.scopePlan?.target_scene_numbers;
      const result = await pipeline.enqueue(documentId, versionId, approvedNotes, protectItems, targetScenes);
      if (result) {
        pipeline.processAll(versionId);
      }
    } finally {
      startGuardRef.current = false;
    }
  };

  const handleResume = () => {
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    try {
      pipeline.processAll(versionId);
    } finally {
      startGuardRef.current = false;
    }
  };

  const handleRetry = async () => {
    await pipeline.retryFailed(versionId);
    pipeline.processAll(versionId);
  };

  const handleAssemble = () => {
    const selected = pipeline.selectedRewriteMode;
    const probe = pipeline.probeResult;
    const reason = selected === 'scene' ? 'user_selected_scene'
      : selected === 'auto' ? 'auto_probe_scene'
      : 'fallback_error';
    pipeline.assemble(documentId, versionId, {
      rewriteModeSelected: selected,
      rewriteModeEffective: 'scene',
      rewriteModeReason: reason,
      rewriteProbe: probe ? {
        has_scenes: probe.has_scenes,
        scenes_count: probe.scenes_count,
        script_chars: probe.script_chars,
      } : undefined,
      rewriteModeDebug: {
        selected,
        probed_has_scenes: probe?.has_scenes ?? null,
        probed_scenes_count: probe?.scenes_count ?? null,
        probed_script_chars: probe?.script_chars ?? null,
        decision_timestamp: new Date().toISOString(),
      },
      rewriteScopePlan: pipeline.scopePlan || undefined,
      rewriteScopeExpandedFrom: pipeline.scopeExpandedFrom || undefined,
      rewriteVerification: pipeline.verification || undefined,
    });
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    const data = await pipeline.preview(versionId);
    setPreviewData(data);
    setPreviewOpen(true);
    setPreviewLoading(false);
  };

  const handleRequeueStuck = () => {
    pipeline.requeueStuck(versionId);
  };

  const handleVerify = async () => {
    const result = await pipeline.verify(versionId);
    if (result && !result.pass && pipeline.scopePlan) {
      // Auto-expand if under limit
      if (pipeline.expansionCount < 3) {
        await pipeline.expandAndContinue(documentId, versionId, result.failures, approvedNotes, protectItems);
      }
    }
  };

  const handleWidenScope = async () => {
    // Reset scope plan to null = rewrite all scenes
    pipeline.setScopePlan(null);
    pipeline.pushActivity('warn', 'Scope widened to all scenes — re-enqueue required');
  };

  const canStart = pipeline.mode === 'idle' && pipeline.total === 0;
  const canResume = (pipeline.mode === 'idle' || pipeline.mode === 'error') && pipeline.queued > 0;
  const canRetry = pipeline.failed > 0;
  const canAssemble = pipeline.done === pipeline.total && pipeline.total > 0 && !pipeline.newVersionId;
  const isWorking = pipeline.mode === 'processing' || pipeline.mode === 'enqueuing' || pipeline.mode === 'assembling';

  const stuckMinutes = 10;
  const isStuck = pipeline.running > 0 && pipeline.oldestRunningClaimedAt &&
    (Date.now() - new Date(pipeline.oldestRunningClaimedAt).getTime()) > stuckMinutes * 60_000;

  const effectiveMode = pipeline.selectedRewriteMode === 'auto'
    ? (pipeline.probeResult?.rewrite_default_mode || pipeline.rewriteMode || '—')
    : pipeline.selectedRewriteMode;

  const scopePlan = pipeline.scopePlan;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Scene Rewrite</span>
          <div className="flex items-center border rounded-md overflow-hidden">
            {MODE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => pipeline.setSelectedRewriteMode(opt.value)}
                disabled={opt.value === 'scene' && pipeline.hasScenes === false}
                className={`px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
                  pipeline.selectedRewriteMode === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                } ${opt.value === 'scene' && pipeline.hasScenes === false ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {pipeline.total > 0 && (
            <span className="text-xs text-muted-foreground">
              {pipeline.scopePlan && pipeline.targetSceneNumbers.length < pipeline.totalScenesInScript
                ? `Selective: ${pipeline.done}/${pipeline.total} target scenes`
                : `${pipeline.done}/${pipeline.total} scenes`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canResume && !isWorking && (
            <Button size="sm" variant="default" onClick={handleResume} disabled={isWorking} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {canStart && !canResume && (
            <Button size="sm" variant="default" onClick={handleStart} disabled={isWorking} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> {scopePlan ? `Start (${scopePlan.target_scene_numbers.length}/${pipeline.totalScenesInScript || '?'} scenes)` : 'Start'}
            </Button>
          )}
          {canRetry && !isWorking && (
            <Button size="sm" variant="outline" onClick={handleRetry} className="h-7 text-xs gap-1">
              <RotateCcw className="h-3 w-3" /> Retry Failed
            </Button>
          )}
          {pipeline.done > 0 && !isWorking && (
            <Button size="sm" variant="outline" onClick={handlePreview} disabled={previewLoading} className="h-7 text-xs gap-1">
              {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Preview
            </Button>
          )}
          {canAssemble && !isWorking && (
            <>
              <Button size="sm" variant="outline" onClick={handleVerify} className="h-7 text-xs gap-1">
                <CheckCircle2 className="h-3 w-3" /> Verify
              </Button>
              <Button size="sm" variant="default" onClick={handleAssemble} className="h-7 text-xs gap-1">
                <Package className="h-3 w-3" /> Assemble
              </Button>
            </>
          )}
          {isWorking && (
            <Button size="sm" variant="ghost" onClick={pipeline.stop} className="h-7 text-xs gap-1">
              <Square className="h-3 w-3" /> Stop
            </Button>
          )}
          {pipeline.mode !== 'idle' && (
            <Button size="sm" variant="ghost" onClick={pipeline.reset} className="h-7 text-xs">
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Scope plan summary */}
      {scopePlan && pipeline.total === 0 && (
        <div className="text-xs p-2 rounded bg-primary/5 border border-primary/20 space-y-1">
          <div className="flex items-center gap-2 font-medium">
            <Target className="h-3 w-3 text-primary" />
            Selective Rewrite: {scopePlan.target_scene_numbers.length} target scene(s)
            {scopePlan.context_scene_numbers.length > 0 && (
              <span className="text-muted-foreground font-normal">
                + {scopePlan.context_scene_numbers.length} context
              </span>
            )}
          </div>
          <div className="text-muted-foreground">{scopePlan.reason}</div>
          {scopePlan.target_scene_numbers.length <= 20 && (
            <div className="text-muted-foreground">
              Scenes: {scopePlan.target_scene_numbers.join(', ')}
            </div>
          )}
        </div>
      )}

      {/* Verification result */}
      {pipeline.verification && (
        <div className={`text-xs p-2 rounded border ${pipeline.verification.pass
          ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
          : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
        }`}>
          <div className="flex items-center gap-1 font-medium">
            {pipeline.verification.pass ? (
              <><CheckCircle2 className="h-3 w-3 text-green-600" /> Verification passed</>
            ) : (
              <><AlertTriangle className="h-3 w-3 text-amber-600" /> {pipeline.verification.failures.length} issue(s) found</>
            )}
          </div>
          {!pipeline.verification.pass && pipeline.verification.failures.slice(0, 3).map((f, i) => (
            <div key={i} className="text-muted-foreground mt-0.5">• [{f.type}] {f.detail}</div>
          ))}
          {!pipeline.verification.pass && pipeline.expansionCount >= 3 && (
            <Button size="sm" variant="outline" onClick={handleWidenScope} className="mt-1 h-6 text-[10px]">
              Widen scope (rewrite all)
            </Button>
          )}
        </div>
      )}

      {/* Probe result banner */}
      {pipeline.probeResult && pipeline.total === 0 && !scopePlan && (
        <div className="text-xs p-2 rounded bg-muted/50 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">Mode: {effectiveMode}</span>
            <span className="text-muted-foreground">•</span>
            <span>{pipeline.probeResult.scenes_count} scenes</span>
            <span className="text-muted-foreground">•</span>
            <span>{pipeline.probeResult.script_chars.toLocaleString()} chars</span>
          </div>
          {!pipeline.probeResult.has_scenes && (
            <div className="text-amber-600 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Scene graph not available — using chunk rewrite fallback.
            </div>
          )}
        </div>
      )}

      {/* Chunk mode warning */}
      {pipeline.selectedRewriteMode === 'chunk' && pipeline.hasScenes && pipeline.total === 0 && (
        <div className="text-xs text-amber-600 p-2 rounded bg-amber-50 dark:bg-amber-950/30">
          Chunk mode selected (scene graph available but bypassed).
        </div>
      )}

      {/* Progress bar */}
      {(isWorking || pipeline.mode === 'complete') && pipeline.total > 0 && (
        <ProcessProgressBar
          percent={pipeline.smoothedPercent}
          actualPercent={pipeline.progress.percent}
          phase={pipeline.progress.phase}
          label={pipeline.progress.label}
          etaMs={pipeline.etaMs}
          status={
            pipeline.mode === 'complete' ? 'success'
            : pipeline.mode === 'error' ? 'error'
            : pipeline.failed > 0 ? 'warn'
            : 'working'
          }
        />
      )}

      {pipeline.error && (
        <div className="text-xs text-destructive">{pipeline.error}</div>
      )}

      {/* Stuck jobs warning */}
      {isStuck && (
        <div className="text-xs p-2 rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 flex items-center justify-between">
          <span className="text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />
            {pipeline.running} job(s) look stuck ({stuckMinutes}+ min).
          </span>
          <Button size="sm" variant="outline" onClick={handleRequeueStuck} className="h-6 text-[10px]">
            Requeue stuck
          </Button>
        </div>
      )}

      {pipeline.newVersionId && (
        <div className="text-xs text-green-600 font-medium">✓ Rewrite complete — new version created</div>
      )}

      {/* Scene list */}
      {pipeline.scenes.length > 0 && (
        <div className="max-h-[400px] overflow-y-auto rounded">
          <div className="space-y-1">
            {pipeline.scenes.map((scene) => {
              const metrics = pipeline.sceneMetrics[scene.scene_number];
              const isTarget = scopePlan?.target_scene_numbers.includes(scene.scene_number);
              const isContext = scopePlan?.context_scene_numbers.includes(scene.scene_number);
              const isSelective = scopePlan != null && pipeline.targetSceneNumbers.length < pipeline.totalScenesInScript;
              const isUntouched = isSelective && !isTarget && !isContext;
              return (
                <div key={scene.scene_number} className={`flex items-center justify-between text-xs py-1 px-2 rounded hover:bg-muted/50 ${isTarget ? 'border-l-2 border-primary/50' : isContext ? 'border-l-2 border-muted-foreground/30' : ''}`}>
                  <span className="truncate flex-1 mr-2">
                    <span className="text-muted-foreground mr-1">#{scene.scene_number}</span>
                    {scene.scene_heading || 'Scene'}
                    {isTarget && <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0 border-primary/50 text-primary">target</Badge>}
                    {isContext && <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0">context</Badge>}
                    {isUntouched && <Badge variant="outline" className="ml-1 text-[8px] px-1 py-0 opacity-50">untouched</Badge>}
                  </span>
                  {metrics && scene.status === 'done' && (
                    <span className="text-muted-foreground mr-2 shrink-0 tabular-nums">
                      {metrics.skipped ? 'skip' : (
                        <>
                          {metrics.duration_ms ? `${(metrics.duration_ms / 1000).toFixed(1)}s` : ''}
                          {metrics.delta_pct != null && (
                            <span className={metrics.delta_pct > 15 ? 'text-amber-500 ml-1' : metrics.delta_pct < -15 ? 'text-blue-500 ml-1' : 'ml-1'}>
                              {metrics.delta_pct > 0 ? '+' : ''}{metrics.delta_pct}%
                            </span>
                          )}
                        </>
                      )}
                    </span>
                  )}
                  {isUntouched ? (
                    <span className="text-muted-foreground text-[9px]">Untouched</span>
                  ) : (
                    <StatusBadge status={scene.status} />
                  )}
                  {scene.error && (
                    <span className="text-destructive ml-2 truncate max-w-32" title={scene.error}>
                      {scene.error}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Summary stats */}
      {pipeline.total > 0 && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {pipeline.queued > 0 && <span>Queued: {pipeline.queued}</span>}
          {pipeline.running > 0 && <span className="text-blue-500">Running: {pipeline.running}</span>}
          {pipeline.done > 0 && <span className="text-green-500">Done: {pipeline.done}</span>}
          {pipeline.failed > 0 && <span className="text-destructive">Failed: {pipeline.failed}</span>}
        </div>
      )}

      {/* Activity timeline */}
      {pipeline.activityItems.length > 0 && (
        <ActivityTimeline items={pipeline.activityItems} onClear={pipeline.clearActivity} />
      )}

      {/* Debug panel */}
      {import.meta.env.DEV && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground flex items-center gap-1">
            <Bug className="h-3 w-3" /> Debug tools
          </summary>
          <div className="mt-1 space-y-1 pl-4">
            <Button size="sm" variant="outline" className="h-6 text-[10px]"
              onClick={() => console.log('[debug] State:', JSON.stringify({
                mode: pipeline.mode, total: pipeline.total, done: pipeline.done, failed: pipeline.failed,
                scopePlan: pipeline.scopePlan, verification: pipeline.verification, expansionCount: pipeline.expansionCount,
              }, null, 2))}>
              Log state
            </Button>
          </div>
        </details>
      )}

      {/* Preview modal */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Rewrite Preview
              {previewData && (
                <span className="font-normal text-muted-foreground ml-2">
                  {previewData.scenes_count} scenes • {previewData.total_chars.toLocaleString()} chars
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          {previewData?.missing_scenes && previewData.missing_scenes.length > 0 && (
            <div className="text-xs text-amber-600 flex items-center gap-1 p-2 rounded bg-amber-50 dark:bg-amber-950/30">
              <AlertTriangle className="h-3 w-3" />
              Missing scenes: {previewData.missing_scenes.join(', ')}
            </div>
          )}
          <ScrollArea className="flex-1 min-h-0">
            <pre className="text-xs whitespace-pre-wrap font-mono p-3 bg-muted/30 rounded">
              {previewData?.preview_text || 'No preview available.'}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
