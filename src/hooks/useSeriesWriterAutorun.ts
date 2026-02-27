/**
 * useSeriesWriterAutorun — Hook for end-to-end series writer autorun.
 *
 * Wraps series-scripts-start/tick with auto_approve + auto_build_master policies.
 * Supports resumable jobs, stop_on_first_fail, and progress polling.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface AutorunItem {
  id: string;
  episode_index: number;
  episode_title: string;
  status: string;
  char_after: number;
  error: string | null;
  auto_approved: boolean;
  approved_version_id: string | null;
}

export interface AutorunJob {
  id: string;
  status: string;
  total_count: number;
  completed_count: number;
  job_type: string;
  policy_json: any;
  error: string | null;
  created_at: string;
}

export interface AutorunProgress {
  total: number;
  completed: number;
  errors: number;
  status: 'idle' | 'running' | 'complete' | 'failed' | 'paused';
  jobId?: string;
  masterBuilt?: boolean;
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
  if (!resp.ok) {
    if (result.error) throw new Error(result.error);
    throw new Error(result.message || 'Request failed');
  }
  return result;
}

export function useSeriesWriterAutorun(projectId: string | undefined) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<AutorunProgress>({ total: 0, completed: 0, errors: 0, status: 'idle' });
  const [items, setItems] = useState<AutorunItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(false);
  const activeJobIdRef = useRef<string | null>(null);

  // Load existing autorun job on mount (resumable)
  const existingJobQuery = useQuery({
    queryKey: ['series-autorun-job', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('regen_jobs')
        .select('*')
        .eq('project_id', projectId)
        .in('job_type', ['series_autorun'])
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
    staleTime: 5000,
  });

  // If there's an existing running job, load its items
  useEffect(() => {
    if (existingJobQuery.data && progress.status === 'idle') {
      const job = existingJobQuery.data;
      activeJobIdRef.current = job.id;
      loadJobStatus(job.id);
    }
  }, [existingJobQuery.data]);

  const loadJobStatus = async (jobId: string) => {
    try {
      const res = await callDevEngine('series-scripts-status', { jobId });
      const job = res.job;
      const jobItems = (res.items || []).map((i: any) => ({
        id: i.id,
        episode_index: i.episode_index || 0,
        episode_title: i.episode_title || `Episode ${i.episode_index}`,
        status: i.status,
        char_after: i.char_after || 0,
        error: i.error,
        auto_approved: i.auto_approved || false,
        approved_version_id: i.approved_version_id,
      }));
      setItems(jobItems);

      const errors = jobItems.filter((i: AutorunItem) => i.status === 'error').length;
      const completed = jobItems.filter((i: AutorunItem) => !['queued', 'running'].includes(i.status)).length;
      const status = job.status === 'complete' ? 'complete' : job.status === 'failed' ? 'failed' : 'running';
      setProgress({ total: job.total_count, completed, errors, status, jobId });
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startAutorun = useCallback(async (opts?: {
    force?: boolean;
    stopOnFirstFail?: boolean;
  }) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    abortRef.current = false;

    const policy = {
      auto_approve: true,
      auto_build_master: true,
      stop_on_first_fail: opts?.stopOnFirstFail ?? false,
    };

    try {
      setProgress({ total: 0, completed: 0, errors: 0, status: 'running' });

      const startRes = await callDevEngine('series-scripts-start', {
        projectId,
        dryRun: false,
        force: opts?.force ?? true,
        policyJson: policy,
      });

      const jobId = startRes.job_id;
      activeJobIdRef.current = jobId;
      const total = startRes.total_count || 0;

      if (total === 0) {
        setProgress({ total: 0, completed: 0, errors: 0, status: 'complete', jobId });
        setLoading(false);
        return;
      }

      setProgress({ total, completed: 0, errors: 0, status: 'running', jobId });
      setItems((startRes.items || []).map((i: any) => ({
        id: i.id,
        episode_index: i.episode_index || 0,
        episode_title: i.episode_title || `Episode ${i.episode_index}`,
        status: i.status,
        char_after: 0,
        error: null,
        auto_approved: false,
        approved_version_id: null,
      })));

      // Tick loop
      let done = false;
      let backoff = 1000;

      while (!done && !abortRef.current) {
        try {
          const tickRes = await callDevEngine('series-scripts-tick', { jobId, maxItemsPerTick: 1 });
          done = tickRes.done === true;

          const job = tickRes.job;
          const completed = job?.completed_count || 0;
          const masterBuilt = tickRes.masterBuilt === true;

          // Refresh items
          await loadJobStatus(jobId);

          if (job?.status === 'failed') {
            setProgress(p => ({ ...p, status: 'failed', masterBuilt }));
            done = true;
          } else {
            setProgress(p => ({
              ...p,
              completed,
              status: done ? 'complete' : 'running',
              masterBuilt: masterBuilt || p.masterBuilt,
            }));
          }
        } catch (tickErr: any) {
          console.error('[autorun tick error]', tickErr.message);
          // Don't abort on transient errors — retry
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        if (!done) {
          await new Promise(r => setTimeout(r, backoff));
          backoff = Math.min(backoff * 1.2, 8000);
        }
      }

      // Final status
      await loadJobStatus(jobId);
      qc.invalidateQueries({ queryKey: ['series-autorun-job', projectId] });
    } catch (e: any) {
      setError(e.message);
      setProgress(p => ({ ...p, status: 'failed' }));
    } finally {
      setLoading(false);
    }
  }, [projectId, qc]);

  const pauseAutorun = useCallback(async () => {
    abortRef.current = true;
    if (activeJobIdRef.current) {
      await (supabase as any).from('regen_jobs')
        .update({ status: 'paused' })
        .eq('id', activeJobIdRef.current);
      setProgress(p => ({ ...p, status: 'paused' }));
    }
  }, []);

  const resumeAutorun = useCallback(async () => {
    if (!activeJobIdRef.current || !projectId) return;
    const jobId = activeJobIdRef.current;

    // Reset to running
    await (supabase as any).from('regen_jobs')
      .update({ status: 'running' })
      .eq('id', jobId);

    setLoading(true);
    abortRef.current = false;
    setProgress(p => ({ ...p, status: 'running' }));

    // Resume tick loop
    let done = false;
    let backoff = 1000;
    while (!done && !abortRef.current) {
      try {
        const tickRes = await callDevEngine('series-scripts-tick', { jobId, maxItemsPerTick: 1 });
        done = tickRes.done === true;
        const job = tickRes.job;
        await loadJobStatus(jobId);
        if (job?.status === 'failed') {
          setProgress(p => ({ ...p, status: 'failed' }));
          done = true;
        } else {
          setProgress(p => ({
            ...p,
            completed: job?.completed_count || p.completed,
            status: done ? 'complete' : 'running',
            masterBuilt: tickRes.masterBuilt || p.masterBuilt,
          }));
        }
      } catch (tickErr: any) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      if (!done) await new Promise(r => setTimeout(r, backoff));
      backoff = Math.min(backoff * 1.2, 8000);
    }

    setLoading(false);
    qc.invalidateQueries({ queryKey: ['series-autorun-job', projectId] });
  }, [projectId, qc]);

  const reset = useCallback(() => {
    abortRef.current = true;
    activeJobIdRef.current = null;
    setItems([]);
    setError(null);
    setProgress({ total: 0, completed: 0, errors: 0, status: 'idle' });
    qc.invalidateQueries({ queryKey: ['series-autorun-job', projectId] });
  }, [projectId, qc]);

  return {
    startAutorun,
    pauseAutorun,
    resumeAutorun,
    reset,
    items,
    progress,
    error,
    loading,
    existingJob: existingJobQuery.data,
  };
}
