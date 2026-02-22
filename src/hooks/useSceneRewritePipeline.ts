import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';
import type { ActivityItem } from '@/components/devengine/ActivityTimeline';

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
  probeResult: ProbeResult | null;
  selectedRewriteMode: 'auto' | 'scene' | 'chunk';
  lastProbedAt: string | null;
  sceneMetrics: Record<number, SceneMetrics>;
  oldestRunningClaimedAt: string | null;
  // Progress / ETA / smoothing
  etaMs: number | null;
  avgUnitMs: number | null;
  smoothedPercent: number;
  lastProgressAt: number;
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
  etaMs: null,
  avgUnitMs: null,
  smoothedPercent: 0,
  lastProgressAt: 0,
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

// Rolling average helper
function rollingAvg(durations: number[], windowSize = 5): number {
  if (durations.length === 0) return 0;
  const window = durations.slice(-windowSize);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

export function useSceneRewritePipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<SceneRewriteState>(initialState);
  const processingRef = useRef(false);
  const stopRef = useRef(false);
  const startGuardRef = useRef(false);
  const durationsRef = useRef<number[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const smoothingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushActivity = useCallback((level: ActivityItem['level'], message: string) => {
    setActivityItems(prev => [{ ts: new Date().toISOString(), level, message }, ...prev].slice(0, 200));
  }, []);

  const clearActivity = useCallback(() => setActivityItems([]), []);

  const invalidate = useCallback(() => {
    invalidateDevEngine(qc, { projectId, deep: true });
  }, [qc, projectId]);

  const setSelectedRewriteMode = useCallback((mode: 'auto' | 'scene' | 'chunk') => {
    setState(s => ({ ...s, selectedRewriteMode: mode }));
  }, []);

  // Start smoothing interval
  const startSmoothing = useCallback(() => {
    if (smoothingTimerRef.current) return;
    smoothingTimerRef.current = setInterval(() => {
      setState(s => {
        if (s.mode !== 'processing' && s.mode !== 'enqueuing') return s;
        const elapsed = Date.now() - s.lastProgressAt;
        if (elapsed < 2500) return s;
        const actualPct = s.total > 0 ? (s.done / s.total) * 100 : 0;
        const maxSmoothed = Math.min(actualPct + 2, 99);
        if (s.smoothedPercent >= maxSmoothed) return s;
        return { ...s, smoothedPercent: Math.min(s.smoothedPercent + 0.3, maxSmoothed) };
      });
    }, 1000);
  }, []);

  const stopSmoothing = useCallback(() => {
    if (smoothingTimerRef.current) {
      clearInterval(smoothingTimerRef.current);
      smoothingTimerRef.current = null;
    }
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
      pushActivity('info', `Probe: ${result.scenes_count} scenes detected (${result.script_chars.toLocaleString()} chars) → ${result.rewrite_default_mode}`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'idle' }));
      pushActivity('error', `Probe failed: ${err.message}`);
      return null;
    }
  }, [projectId, pushActivity]);

  // Load existing status (for resume after refresh)
  const loadStatus = useCallback(async (sourceVersionId: string) => {
    if (!projectId) return;
    try {
      const result = await callEngine('get_rewrite_status', { projectId, sourceVersionId });
      if (result.total > 0) {
        const pct = result.total > 0 ? (result.done / result.total) * 100 : 0;
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
          smoothedPercent: pct,
          lastProgressAt: Date.now(),
        }));
        pushActivity('info', `Loaded status: ${result.done}/${result.total} done, ${result.queued} queued, ${result.failed} failed`);
      }
    } catch { /* non-critical */ }
  }, [projectId, pushActivity]);

  // Enqueue all scene jobs
  const enqueue = useCallback(async (
    sourceDocId: string,
    sourceVersionId: string,
    approvedNotes: any[],
    protectItems: string[],
  ) => {
    if (!projectId) return;
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    setState(s => ({ ...s, mode: 'enqueuing', error: null, newVersionId: null }));
    pushActivity('info', 'Enqueuing scene jobs…');
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
        smoothedPercent: result.alreadyExists ? s.smoothedPercent : 0,
        lastProgressAt: Date.now(),
      }));
      pushActivity(result.alreadyExists ? 'warn' : 'success', 
        result.alreadyExists 
          ? `Jobs already exist (${result.totalScenes} scenes) — resuming` 
          : `Enqueued ${result.totalScenes} scene jobs`
      );
      toast.success(`${result.totalScenes} scenes queued for rewrite`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      pushActivity('error', `Enqueue failed: ${err.message}`);
      toast.error(err.message);
      return null;
    } finally {
      startGuardRef.current = false;
    }
  }, [projectId, pushActivity]);

  // Process jobs one at a time in a loop
  const processAll = useCallback(async (sourceVersionId: string) => {
    if (!projectId || processingRef.current) return;
    processingRef.current = true;
    stopRef.current = false;
    durationsRef.current = [];
    setState(s => ({ ...s, mode: 'processing', lastProgressAt: Date.now() }));
    startSmoothing();
    pushActivity('info', 'Processing started');

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

        // Track duration for ETA
        if (result.duration_ms && !result.skipped) {
          durationsRef.current.push(result.duration_ms);
        }

        // Store per-scene metrics
        if (result.scene_number) {
          const durationStr = result.duration_ms ? `${(result.duration_ms / 1000).toFixed(1)}s` : '';
          const deltaStr = result.delta_pct != null ? ` ${result.delta_pct > 0 ? '+' : ''}${result.delta_pct}%` : '';
          pushActivity(
            result.status === 'done' ? 'success' : 'error',
            result.skipped 
              ? `Scene ${result.scene_number} skipped (already done)` 
              : `Scene ${result.scene_number} ${result.status} (${durationStr}${deltaStr})`
          );

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

        // Update local state optimistically
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
          const actualPct = s.total > 0 ? (newDone / s.total) * 100 : 0;
          const avg = rollingAvg(durationsRef.current);
          const remaining = s.total - newDone - newFailed;
          return {
            ...s,
            scenes: updatedScenes,
            done: newDone,
            failed: newFailed,
            queued: newQueued,
            running: newRunning,
            smoothedPercent: Math.max(s.smoothedPercent, actualPct),
            lastProgressAt: Date.now(),
            avgUnitMs: avg > 0 ? avg : null,
            etaMs: avg > 0 && remaining > 0 ? avg * remaining : null,
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
        smoothedPercent: allDone ? 100 : s.smoothedPercent,
        etaMs: allDone ? null : s.etaMs,
      }));

      if (allDone) {
        pushActivity('success', `All ${finalStatus.total} scenes rewritten successfully`);
        toast.success(`All ${finalStatus.total} scenes rewritten successfully`);
      } else if (finalStatus.failed > 0) {
        pushActivity('warn', `${finalStatus.failed} scene(s) failed — retry available`);
        toast.warning(`${finalStatus.failed} scene(s) failed. You can retry them.`);
      }
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      pushActivity('error', `Processing error: ${err.message}`);
      toast.error(`Scene rewrite error: ${err.message}`);
    } finally {
      processingRef.current = false;
      stopSmoothing();
    }
  }, [projectId, pushActivity, startSmoothing, stopSmoothing]);

  const stop = useCallback(() => {
    stopRef.current = true;
    stopSmoothing();
    pushActivity('warn', 'Processing stopped by user');
  }, [stopSmoothing, pushActivity]);

  const retryFailed = useCallback(async (sourceVersionId: string) => {
    if (!projectId) return;
    try {
      const result = await callEngine('retry_failed_rewrite_jobs', { projectId, sourceVersionId });
      pushActivity('info', `Re-queued ${result.reset} failed scene(s)`);
      toast.success(`${result.reset} failed scene(s) re-queued`);
      await loadStatus(sourceVersionId);
    } catch (err: any) {
      pushActivity('error', `Retry failed: ${err.message}`);
      toast.error(err.message);
    }
  }, [projectId, loadStatus, pushActivity]);

  const assemble = useCallback(async (sourceDocId: string, sourceVersionId: string, provenance?: { rewriteModeSelected?: string; rewriteModeEffective?: string; rewriteModeReason?: string; rewriteModeDebug?: any; rewriteProbe?: any }) => {
    if (!projectId) return;
    setState(s => ({ ...s, mode: 'assembling' }));
    pushActivity('info', 'Assembling final script…');
    try {
      const result = await callEngine('assemble_rewritten_script', {
        projectId, sourceDocId, sourceVersionId,
        rewriteModeSelected: provenance?.rewriteModeSelected || state.selectedRewriteMode || 'auto',
        rewriteModeEffective: provenance?.rewriteModeEffective || 'scene',
        rewriteModeReason: provenance?.rewriteModeReason || 'auto_probe_scene',
        rewriteModeDebug: provenance?.rewriteModeDebug || null,
        rewriteProbe: provenance?.rewriteProbe || state.probeResult || null,
      });
      setState(s => ({ ...s, mode: 'complete', newVersionId: result.newVersionId, smoothedPercent: 100, etaMs: null }));
      invalidate();
      pushActivity('success', `Assembled ${result.scenesCount} scenes → ${result.charCount.toLocaleString()} chars`);
      toast.success(`Assembled ${result.scenesCount} scenes → ${result.charCount.toLocaleString()} chars`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      pushActivity('error', `Assemble failed: ${err.message}`);
      toast.error(err.message);
      return null;
    }
  }, [projectId, invalidate, pushActivity]);

  // Requeue stuck jobs
  const requeueStuck = useCallback(async (sourceVersionId: string, stuckMinutes = 10) => {
    if (!projectId) return;
    try {
      const result = await callEngine('requeue_stuck_rewrite_jobs', { projectId, sourceVersionId, stuckMinutes });
      pushActivity('warn', `Requeued ${result.requeued} stuck job(s)`);
      toast.success(`${result.requeued} stuck job(s) requeued`);
      await loadStatus(sourceVersionId);
    } catch (err: any) {
      pushActivity('error', `Requeue stuck failed: ${err.message}`);
      toast.error(err.message);
    }
  }, [projectId, loadStatus, pushActivity]);

  // Preview assembled output
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
    stopSmoothing();
    setState(initialState);
    durationsRef.current = [];
  }, [stopSmoothing]);

  const actualPercent = state.total > 0 ? Math.floor((state.done / state.total) * 100) : 0;

  const progress = {
    phase: state.mode === 'probing' ? 'probing'
      : state.mode === 'enqueuing' ? 'enqueuing'
      : state.mode === 'processing' ? 'processing_scene'
      : state.mode === 'assembling' ? 'assembling'
      : state.mode === 'complete' ? 'complete'
      : state.mode === 'error' ? 'error'
      : 'queued',
    total: state.total,
    completed: state.done,
    running: state.running,
    failed: state.failed,
    queued: state.queued,
    percent: actualPercent,
    label: state.mode === 'probing' ? 'Probing scenes…'
      : state.mode === 'enqueuing' ? 'Splitting into scenes…'
      : state.mode === 'processing' ? `Scene ${state.done}/${state.total}`
      : state.mode === 'assembling' ? 'Assembling final script…'
      : state.mode === 'complete' ? 'Complete'
      : state.mode === 'error' ? (state.error || 'Error')
      : '',
  };

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
    // New exports
    progress,
    activityItems,
    clearActivity,
    pushActivity,
  };
}
