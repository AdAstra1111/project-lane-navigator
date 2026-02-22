import { useState, useCallback, useRef, useEffect } from 'react';
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
}

const initialState: SceneRewriteState = {
  mode: 'idle',
  hasScenes: null,
  scenesCount: 0,
  total: 0, queued: 0, running: 0, done: 0, failed: 0,
  scenes: [],
  error: null,
  newVersionId: null,
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

  // Probe whether scenes exist
  const probe = useCallback(async (sourceDocId: string, sourceVersionId: string) => {
    if (!projectId) return null;
    setState(s => ({ ...s, mode: 'probing' }));
    try {
      const result = await callEngine('rewrite_debug_probe', { projectId, sourceDocId, sourceVersionId });
      setState(s => ({
        ...s,
        mode: 'idle',
        hasScenes: result.has_scenes,
        scenesCount: result.scenes_count,
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
          mode: result.done === result.total ? 'complete'
            : (result.queued > 0 || result.running > 0) ? 'processing' : 'idle',
          hasScenes: true,
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

    try {
      let consecutiveEmpty = 0;
      while (!stopRef.current) {
        const result = await callEngine('process_next_rewrite_job', { projectId, sourceVersionId });

        if (!result.processed) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break; // truly no more jobs
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        consecutiveEmpty = 0;

        // Refresh status
        const status = await callEngine('get_rewrite_status', { projectId, sourceVersionId });
        setState(s => ({
          ...s,
          total: status.total,
          queued: status.queued,
          running: status.running,
          done: status.done,
          failed: status.failed,
          scenes: status.scenes || [],
        }));

        if (status.queued === 0 && status.running === 0) break;

        // Small delay between scenes to avoid hammering
        await new Promise(r => setTimeout(r, 300));
      }

      // Final status
      const finalStatus = await callEngine('get_rewrite_status', { projectId, sourceVersionId });
      const allDone = finalStatus.done === finalStatus.total;
      setState(s => ({
        ...s,
        ...finalStatus,
        scenes: finalStatus.scenes || [],
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

  const assemble = useCallback(async (sourceDocId: string, sourceVersionId: string) => {
    if (!projectId) return;
    setState(s => ({ ...s, mode: 'assembling' }));
    try {
      const result = await callEngine('assemble_rewritten_script', { projectId, sourceDocId, sourceVersionId });
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
    reset,
    isProcessing: processingRef.current,
  };
}
