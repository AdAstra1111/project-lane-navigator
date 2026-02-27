import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SeriesScriptItem {
  id: string;
  episode_index: number;
  episode_title: string;
  doc_type: string;
  status: string;
  reason: string;
  char_before: number;
  char_after: number;
  document_id: string | null;
  error: string | null;
}

export interface SeriesScriptJob {
  id: string;
  status: string;
  total_count: number;
  completed_count: number;
  dry_run: boolean;
  job_type: string;
}

export interface SeriesScriptProgress {
  total: number;
  completed: number;
  status: 'idle' | 'scanning' | 'running' | 'complete' | 'error';
  jobId?: string;
}

async function callDevEngine(action: string, body: Record<string, any>): Promise<any> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Request failed');
  return result;
}

export function useGenerateSeriesScripts(projectId: string | undefined) {
  const [scanResult, setScanResult] = useState<{ job: SeriesScriptJob; items: SeriesScriptItem[] } | null>(null);
  const [result, setResult] = useState<{ job: SeriesScriptJob; items: SeriesScriptItem[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<SeriesScriptProgress>({ total: 0, completed: 0, status: 'idle' });
  const abortRef = useRef(false);

  const scan = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setProgress(p => ({ ...p, status: 'scanning' }));
    try {
      const res = await callDevEngine('series-scripts-start', { projectId, dryRun: true });
      setScanResult({ job: res.job, items: res.items || [] });
      setProgress({ total: res.total_count, completed: 0, status: 'idle', jobId: res.job_id });
      return res;
    } catch (e: any) {
      setError(e.message);
      setProgress(p => ({ ...p, status: 'error' }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const generate = useCallback(async (opts?: { episodeStart?: number; episodeEnd?: number; force?: boolean }) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    abortRef.current = false;
    setProgress({ total: 0, completed: 0, status: 'running' });

    try {
      const startRes = await callDevEngine('series-scripts-start', {
        projectId,
        dryRun: false,
        force: opts?.force,
        episodeStart: opts?.episodeStart,
        episodeEnd: opts?.episodeEnd,
      });
      const jobId = startRes.job_id;
      const total = startRes.total_count || 0;
      setProgress({ total, completed: 0, status: 'running', jobId });

      if (total === 0) {
        setProgress({ total: 0, completed: 0, status: 'complete', jobId });
        setResult({ job: startRes.job, items: [] });
        setScanResult(null);
        return startRes;
      }

      // Tick loop
      let done = false;
      let backoff = 800;

      while (!done && !abortRef.current) {
        const tickRes = await callDevEngine('series-scripts-tick', { jobId, maxItemsPerTick: 1 });
        done = tickRes.done === true;

        const completed = tickRes.job?.completed_count || 0;
        setProgress({ total, completed, status: done ? 'complete' : 'running', jobId });

        if (!done) {
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 1.3, 5000);
        }
      }

      // Fetch final status
      const statusRes = await callDevEngine('series-scripts-status', { jobId });
      setResult({ job: statusRes.job, items: statusRes.items || [] });
      setScanResult(null);
      setProgress({ total, completed: total, status: 'complete', jobId });
      return statusRes;
    } catch (e: any) {
      setError(e.message);
      setProgress(p => ({ ...p, status: 'error' }));
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setScanResult(null);
    setResult(null);
    setError(null);
    setProgress({ total: 0, completed: 0, status: 'idle' });
    abortRef.current = true;
  }, []);

  return { scan, generate, clear, scanResult, result, loading, error, progress };
}
