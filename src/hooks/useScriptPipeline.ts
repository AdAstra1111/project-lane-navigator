import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface PipelineBatch {
  index: number;
  scenes: any[];
  totalPages: number;
}

interface PipelineState {
  status: 'idle' | 'planning' | 'writing' | 'assembling' | 'complete' | 'paused' | 'error';
  plan: any | null;
  scriptDocId: string | null;
  scriptVersionId: string | null;
  batches: PipelineBatch[];
  currentBatch: number;
  totalBatches: number;
  assembledText: string;
  wordCount: number;
  pageEstimate: number;
  error: string | null;
}

async function callEngine(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const text = await resp.text();
  if (!text || text.trim().length === 0) {
    throw new Error('Empty response from engine — the request may have timed out. Try again.');
  }
  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    // Attempt to repair truncated JSON
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > 0) {
      try {
        result = JSON.parse(text.substring(0, lastBrace + 1));
        console.warn('Recovered truncated JSON response');
      } catch {
        throw new Error('Invalid response from engine — please retry.');
      }
    } else {
      throw new Error('Invalid response from engine — please retry.');
    }
  }
  if (resp.status === 402) throw new Error('AI credits exhausted. Please add funds to your workspace under Settings → Usage.');
  if (resp.status === 429) throw new Error('Rate limit reached. Please try again in a moment.');
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

export function useScriptPipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<PipelineState>({
    status: 'idle',
    plan: null,
    scriptDocId: null,
    scriptVersionId: null,
    batches: [],
    currentBatch: 0,
    totalBatches: 0,
    assembledText: '',
    wordCount: 0,
    pageEstimate: 0,
    error: null,
  });

  const pausedRef = useRef(false);
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
  }, [qc, projectId]);

  const startPipeline = useCallback(async (
    documentId: string,
    versionId: string,
    targetPages: number = 100,
    protectItems: string[] = [],
  ) => {
    if (!projectId || runningRef.current) return;
    runningRef.current = true;
    pausedRef.current = false;
    abortRef.current = false;

    try {
      // Step 1: SCRIPT_PLAN
      setState(s => ({ ...s, status: 'planning', error: null, assembledText: '', currentBatch: 0, wordCount: 0, pageEstimate: 0 }));
      
      const planResult = await callEngine('script-plan', {
        projectId, documentId, versionId, targetPages, protectItems,
      });

      const { plan, batches, totalBatches, scriptDoc, scriptVersion } = planResult;

      setState(s => ({
        ...s,
        status: 'writing',
        plan,
        scriptDocId: scriptDoc.id,
        scriptVersionId: scriptVersion.id,
        batches,
        totalBatches,
        currentBatch: 0,
      }));

      // Step 2: WRITE_SCENES_BATCH (loop)
      let assembled = '';
      for (let i = 0; i < batches.length; i++) {
        if (abortRef.current) {
          setState(s => ({ ...s, status: 'error', error: 'Aborted by user' }));
          return;
        }
        if (pausedRef.current) {
          setState(s => ({ ...s, status: 'paused' }));
          // Wait for resume
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (!pausedRef.current || abortRef.current) {
                clearInterval(check);
                resolve();
              }
            }, 500);
          });
          if (abortRef.current) {
            setState(s => ({ ...s, status: 'error', error: 'Aborted by user' }));
            return;
          }
          setState(s => ({ ...s, status: 'writing' }));
        }

        setState(s => ({ ...s, currentBatch: i }));

        const batch = batches[i];
        // Only send last 2500 chars for continuity (edge function uses last 2000)
        const continuityText = assembled.length > 2500 ? assembled.slice(-2500) : assembled;
        const batchResult = await callEngine('write-batch', {
          projectId,
          scriptDocId: scriptDoc.id,
          scriptVersionId: scriptVersion.id,
          batchIndex: i,
          scenes: batch.scenes,
          previousText: continuityText,
          toneLock: plan.rules?.tone_lock,
          nonNegotiables: plan.rules?.non_negotiables,
          totalBatches,
        });

        assembled += (assembled ? '\n\n' : '') + batchResult.text;
        const wc = assembled.split(/\s+/).length;
        setState(s => ({
          ...s,
          assembledText: assembled,
          wordCount: wc,
          pageEstimate: Math.round(wc / 250),
        }));
      }

      // Step 3: ASSEMBLE_SCRIPT
      setState(s => ({ ...s, status: 'assembling', currentBatch: batches.length }));

      const assembleResult = await callEngine('assemble-script', {
        projectId,
        scriptDocId: scriptDoc.id,
        scriptVersionId: scriptVersion.id,
        assembledText: assembled,
        planJson: plan,
      });

      setState(s => ({
        ...s,
        status: 'complete',
        wordCount: assembleResult.wordCount,
        pageEstimate: assembleResult.pageEstimate,
      }));

      invalidate();
      toast.success(`Feature screenplay generated — ${assembleResult.pageEstimate} pages`);

    } catch (err: any) {
      console.error('Pipeline error:', err);
      setState(s => ({ ...s, status: 'error', error: err.message }));
      toast.error(`Pipeline error: ${err.message}`);
    } finally {
      runningRef.current = false;
    }
  }, [projectId, invalidate]);

  const pause = useCallback(() => {
    pausedRef.current = true;
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
    pausedRef.current = false;
    runningRef.current = false;
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    pausedRef.current = false;
    setState({
      status: 'idle',
      plan: null,
      scriptDocId: null,
      scriptVersionId: null,
      batches: [],
      currentBatch: 0,
      totalBatches: 0,
      assembledText: '',
      wordCount: 0,
      pageEstimate: 0,
      error: null,
    });
  }, []);

  return {
    ...state,
    startPipeline,
    pause,
    resume,
    abort,
    reset,
  };
}
