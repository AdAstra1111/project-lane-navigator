import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface RewritePipelineState {
  status: 'idle' | 'planning' | 'writing' | 'assembling' | 'complete' | 'error';
  totalChunks: number;
  currentChunk: number;
  error: string | null;
  newVersionId: string | null;
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
  if (!text || text.trim().length === 0) throw new Error('Empty response from engine');
  let result: any;
  try { result = JSON.parse(text); } catch {
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace > 0) {
      try { result = JSON.parse(text.substring(0, lastBrace + 1)); } catch {
        throw new Error('Invalid response from engine');
      }
    } else throw new Error('Invalid response from engine');
  }
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

export function useRewritePipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<RewritePipelineState>({
    status: 'idle', totalChunks: 0, currentChunk: 0, error: null, newVersionId: null,
  });
  const runningRef = useRef(false);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
    qc.invalidateQueries({ queryKey: ['dev-v2-versions'] });
    qc.invalidateQueries({ queryKey: ['dev-v2-runs'] });
    qc.invalidateQueries({ queryKey: ['dev-v2-doc-runs'] });
    qc.invalidateQueries({ queryKey: ['dev-v2-convergence'] });
  }, [qc, projectId]);

  const startRewrite = useCallback(async (
    documentId: string,
    versionId: string,
    approvedNotes: any[],
    protectItems: string[],
  ) => {
    if (!projectId || runningRef.current) return;
    runningRef.current = true;

    try {
      // Step 1: Plan
      setState(s => ({ ...s, status: 'planning', error: null, newVersionId: null }));

      const plan = await callEngine('rewrite-plan', {
        projectId, documentId, versionId, approvedNotes, protectItems,
      });

      const { planRunId, totalChunks } = plan;
      setState(s => ({ ...s, status: 'writing', totalChunks, currentChunk: 0 }));

      // Step 2: Write chunks
      let previousChunkEnding = '';
      const rewrittenChunks: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        setState(s => ({ ...s, currentChunk: i + 1 }));

        const result = await callEngine('rewrite-chunk', {
          planRunId,
          chunkIndex: i,
          previousChunkEnding: previousChunkEnding.slice(-2000),
        });

        rewrittenChunks.push(result.rewrittenText);
        previousChunkEnding = result.rewrittenText;
      }

      // Step 3: Assemble
      setState(s => ({ ...s, status: 'assembling' }));
      const assembledText = rewrittenChunks.join('\n\n');

      const assembleResult = await callEngine('rewrite-assemble', {
        projectId, documentId, versionId, planRunId, assembledText,
      });

      setState(s => ({
        ...s, status: 'complete', newVersionId: assembleResult.newVersion?.id || null,
      }));

      invalidate();
      toast.success(`Full rewrite complete — ${assembledText.length.toLocaleString()} chars`);

    } catch (err: any) {
      console.error('Rewrite pipeline error:', err);
      setState(s => ({ ...s, status: 'error', error: err.message }));
      toast.error(`Rewrite error: ${err.message}`);
    } finally {
      runningRef.current = false;
    }
  }, [projectId, invalidate]);

  const reset = useCallback(() => {
    setState({ status: 'idle', totalChunks: 0, currentChunk: 0, error: null, newVersionId: null });
  }, []);

  return { ...state, startRewrite, reset, isRunning: runningRef.current };
}
