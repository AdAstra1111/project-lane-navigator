import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';

export interface SceneRewriteJob {
  scene_number: number;
  scene_heading?: string;
  status: string;
  attempts: number;
  error?: string | null;
  claimed_at?: string | null;
}

export interface SceneMetrics {
  duration_ms?: number;
  input_chars?: number;
  output_chars?: number;
  delta_pct?: number;
  skipped?: boolean;
}

export interface ProbeResult {
  has_scenes: boolean;
  scenes_count: number;
  rewrite_default_mode: 'scene' | 'chunk';
  script_chars: number;
}

export interface PreviewResult {
  preview_text: string;
  total_chars: number;
  scenes_count: number;
  missing_scenes: number[];
}

export interface SceneRewriteState {
  mode: 'idle' | 'probing' | 'enqueuing' | 'processing' | 'assembling' | 'complete' | 'error';
  hasScenes: boolean | null;
  scenesCount: number;
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  scenes: SceneRewriteJob[];
  error: string | null;
  newVersionId: string | null;
  rewriteMode: 'scene' | 'chunk' | null;
  // Improvement 1
  probeResult: ProbeResult | null;
  selectedRewriteMode: 'auto' | 'scene' | 'chunk';
  lastProbedAt: string | null;
  // Improvement 3
  sceneMetrics: Record<number, SceneMetrics>;
  // Improvement 4
  oldestRunningClaimedAt: string | null;
}

const initialState: SceneRewriteState = {
  mode: 'idle',
  hasScenes: null,
  scenesCount: 0,
  total: 0, queued: 0, running: 0, done: 0, failed: 0,
  scenes: [],
  error: null,
  newVersionId: null,
  rewriteMode: null,
  probeResult: null,
  selectedRewriteMode: 'auto',
  lastProbedAt: null,
  sceneMetrics: {},
  oldestRunningClaimedAt: null,
};

async function callEngine(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const text = await resp.text();
  if (!text || text.trim().length === 0) throw new Error('Empty response from engine');
  let result: any;
  try { result = JSON.parse(text); } catch {
    throw new Error('Invalid response from engine');
  }
  if (resp.status === 402) throw new Error('AI credits exhausted.');
  if (resp.status === 429) throw new Error('Rate limit reached. Try again in a moment.');
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

export function useSceneRewritePipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<SceneRewriteState>(initialState);
  const processingRef = useRef(false);
  const stopRef = useRef(false);

  const invalidate = useCallback(() => {
    invalidateDevEngine(qc, { projectId, deep: true });
  }, [qc, projectId]);

  const setSelectedRewriteMode = useCallback((mode: 'auto' | 'scene' | 'chunk') => {
    setState(s => ({ ...s, selectedRewriteMode: mode }));
  }, []);

  // Probe whether scenes exist
  const probe = useCallback(async (sourceDocId: string, sourceVersionId: string) => {
    if (!projectId) return null;
    setState(s => ({ ...s, mode: 'probing' }));
    try {
      const result = await callEngine('rewrite_debug_probe', { projectId, sourceDocId, sourceVersionId });
      const probeResult: ProbeResult = {
        has_scenes: result.has_scenes,
        scenes_count: result.scenes_count,
        rewrite_default_mode: result.rewrite_default_mode,
        script_chars: result.script_chars,
      };
      setState(s => ({
        ...s,
        mode: 'idle',
        hasScenes: result.has_scenes,
        scenesCount: result.scenes_count,
        rewriteMode: result.rewrite_default_mode,
        probeResult,
        lastProbedAt: new Date().toISOString(),
      }));
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'idle' }));
      return null;
    }
  }, [projectId]);

  // Load existing status (for resume after refresh)
  const loadStatus = useCallback(async (sourceVersionId: string) => {
    if (!projectId) return;
    try {
      const result = await callEngine('get_rewrite_status', { projectId, sourceVersionId });
      if (result.total > 0) {
        setState(s => ({
          ...s,
          total: result.total,
          queued: result.queued,
          running: result.running,
          done: result.done,
          failed: result.failed,
          scenes: result.scenes || [],
          oldestRunningClaimedAt: result.oldest_running_claimed_at || null,
          mode: result.done === result.total ? 'complete'
            : (result.queued > 0 || result.running > 0) ? 'processing' : 'idle',
          // Don't force hasScenes — keep whatever probe set (or null if not probed)
          rewriteMode: s.rewriteMode || 'scene',
        }));
      }
    } catch { /* non-critical */ }
  }, [projectId]);

  // Enqueue all scene jobs
  const enqueue = useCallback(async (
    sourceDocId: string,
    sourceVersionId: string,
    approvedNotes: any[],
    protectItems: string[],
  ) => {
    if (!projectId) return;
    setState(s => ({ ...s, mode: 'enqueuing', error: null, newVersionId: null }));
    try {
      const result = await callEngine('enqueue_rewrite_jobs', {
        projectId, sourceDocId, sourceVersionId, approvedNotes, protectItems,
      });
      setState(s => ({
        ...s,
        mode: 'processing',
        total: result.totalScenes,
        queued: result.queued || result.totalScenes,
        done: result.alreadyExists ? s.done : 0,
        failed: 0,
        running: 0,
        rewriteMode: 'scene',
      }));
      toast.success(`${result.totalScenes} scenes queued for rewrite`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      toast.error(err.message);
      return null;
    }
  }, [projectId]);

  // Process jobs one at a time in a loop
  const processAll = useCallback(async (sourceVersionId: string) => {
    if (!projectId || processingRef.current) return;
    processingRef.current = true;
    stopRef.current = false;
    setState(s => ({ ...s, mode: 'processing' }));

    let scenesProcessed = 0;

    try {
      let consecutiveEmpty = 0;
      while (!stopRef.current) {
        const result = await callEngine('process_next_rewrite_job', { projectId, sourceVersionId });

        if (stopRef.current) break;

        if (!result.processed) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        consecutiveEmpty = 0;
        scenesProcessed++;

        // Store per-scene metrics (Improvement 3)
        if (result.scene_number) {
          setState(s => ({
            ...s,
            sceneMetrics: {
              ...s.sceneMetrics,
              [result.scene_number]: {
                duration_ms: result.duration_ms,
                input_chars: result.input_chars,
                output_chars: result.output_chars,
                delta_pct: result.delta_pct,
                skipped: result.skipped,
              },
            },
          }));
        }

        // Update local state optimistically from the returned scene info
        setState(s => {
          const updatedScenes = s.scenes.map(sc =>
            sc.scene_number === result.scene_number
              ? { ...sc, status: result.status, error: result.error || null }
              : sc
          );
          const newDone = updatedScenes.filter(sc => sc.status === 'done').length;
          const newFailed = updatedScenes.filter(sc => sc.status === 'failed').length;
          const newQueued = updatedScenes.filter(sc => sc.status === 'queued').length;
          const newRunning = updatedScenes.filter(sc => sc.status === 'running').length;
          return {
            ...s,
            scenes: updatedScenes,
            done: newDone,
            failed: newFailed,
            queued: newQueued,
            running: newRunning,
          };
        });

        if (stopRef.current) break;

        // Full status refresh every 5 scenes
        if (scenesProcessed % 5 === 0) {
          const status = await callEngine('get_rewrite_status', { projectId, sourceVersionId });
          setState(s => ({
            ...s,
            total: status.total,
            queued: status.queued,
            running: status.running,
            done: status.done,
            failed: status.failed,
            scenes: status.scenes || [],
            oldestRunningClaimedAt: status.oldest_running_claimed_at || null,
          }));
          if (status.queued === 0 && status.running === 0) break;
        }

        // Small delay between scenes
        await new Promise(r => setTimeout(r, 200));
      }

      // Final status
      const finalStatus = await callEngine('get_rewrite_status', { projectId, sourceVersionId });
      const allDone = finalStatus.done === finalStatus.total;
      setState(s => ({
        ...s,
        ...finalStatus,
        scenes: finalStatus.scenes || [],
        oldestRunningClaimedAt: finalStatus.oldest_running_claimed_at || null,
        mode: allDone ? 'complete' : (finalStatus.failed > 0 ? 'error' : 'idle'),
        error: finalStatus.failed > 0 ? `${finalStatus.failed} scene(s) failed` : null,
      }));

      if (allDone) {
        toast.success(`All ${finalStatus.total} scenes rewritten successfully`);
      } else if (finalStatus.failed > 0) {
        toast.warning(`${finalStatus.failed} scene(s) failed. You can retry them.`);
      }
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      toast.error(`Scene rewrite error: ${err.message}`);
    } finally {
      processingRef.current = false;
    }
  }, [projectId]);

  const stop = useCallback(() => {
    stopRef.current = true;
  }, []);

  const retryFailed = useCallback(async (sourceVersionId: string) => {
    if (!projectId) return;
    try {
      const result = await callEngine('retry_failed_rewrite_jobs', { projectId, sourceVersionId });
      toast.success(`${result.reset} failed scene(s) re-queued`);
      await loadStatus(sourceVersionId);
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [projectId, loadStatus]);

  const assemble = useCallback(async (sourceDocId: string, sourceVersionId: string, provenance?: { rewriteModeSelected?: string; rewriteProbe?: any }) => {
    if (!projectId) return;
    setState(s => ({ ...s, mode: 'assembling' }));
    try {
      const result = await callEngine('assemble_rewritten_script', {
        projectId, sourceDocId, sourceVersionId,
        rewriteModeSelected: provenance?.rewriteModeSelected || state.selectedRewriteMode || 'auto',
        rewriteProbe: provenance?.rewriteProbe || state.probeResult || null,
      });
      setState(s => ({ ...s, mode: 'complete', newVersionId: result.newVersionId }));
      invalidate();
      toast.success(`Assembled ${result.scenesCount} scenes → ${result.charCount.toLocaleString()} chars`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      toast.error(err.message);
      return null;
    }
  }, [projectId, invalidate]);

  // Improvement 4: Requeue stuck jobs
  const requeueStuck = useCallback(async (sourceVersionId: string, stuckMinutes = 10) => {
    if (!projectId) return;
    try {
      const result = await callEngine('requeue_stuck_rewrite_jobs', { projectId, sourceVersionId, stuckMinutes });
      toast.success(`${result.requeued} stuck job(s) requeued`);
      await loadStatus(sourceVersionId);
    } catch (err: any) {
      toast.error(err.message);
    }
  }, [projectId, loadStatus]);

  // Improvement 5: Preview assembled output
  const preview = useCallback(async (sourceVersionId: string, maxChars = 8000): Promise<PreviewResult | null> => {
    if (!projectId) return null;
    try {
      return await callEngine('preview_assembled_rewrite', { projectId, sourceVersionId, maxChars }) as PreviewResult;
    } catch (err: any) {
      toast.error(err.message);
      return null;
    }
  }, [projectId]);

  const reset = useCallback(() => {
    stopRef.current = true;
    setState(initialState);
  }, []);

  return {
    ...state,
    probe,
    loadStatus,
    enqueue,
    processAll,
    stop,
    retryFailed,
    assemble,
    requeueStuck,
    preview,
    reset,
    setSelectedRewriteMode,
    isProcessing: processingRef.current,
  };
}
