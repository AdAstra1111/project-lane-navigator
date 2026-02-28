/**
 * useDevSeedBackfill — Hook for managing DevSeed backfill pipeline with visible progress.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface DevSeedJobItem {
  id: string;
  job_id: string;
  item_key: string;
  doc_type: string;
  episode_index: number | null;
  status: 'queued' | 'claimed' | 'running' | 'complete' | 'failed';
  attempts: number;
  error_code: string | null;
  error_detail: string | null;
  output_doc_id: string | null;
  output_version_id: string | null;
  gate_score: number | null;
  gate_failures: string[] | null;
}

export interface DevSeedJob {
  id: string;
  pitch_idea_id: string;
  project_id: string | null;
  lane: string | null;
  mode: 'minimal' | 'backfill';
  status: 'queued' | 'running' | 'paused' | 'failed' | 'complete';
  include_dev_pack: boolean;
  progress_json: {
    total_items: number;
    done_items: number;
    current_step: string | null;
    blockers: string[];
    last_error: string | null;
  };
  error: string | null;
  created_at: string;
}

async function callOrchestrator(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/devseed-orchestrator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Backfill error');
  return result;
}

export function useDevSeedBackfill(projectId: string | undefined, pitchIdeaId: string | undefined) {
  const qc = useQueryClient();
  const [job, setJob] = useState<DevSeedJob | null>(null);
  const [items, setItems] = useState<DevSeedJobItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef(false);

  // Load existing job on mount (resumable)
  const { data: existingJob } = useQuery({
    queryKey: ['devseed-backfill-job', projectId, pitchIdeaId],
    queryFn: async () => {
      if (!projectId && !pitchIdeaId) return null;
      const result = await callOrchestrator('status', { projectId, pitchIdeaId });
      return result;
    },
    enabled: !!(projectId || pitchIdeaId),
    refetchOnWindowFocus: false,
    staleTime: 5000,
  });

  useEffect(() => {
    if (existingJob?.job) {
      setJob(existingJob.job);
      setItems(existingJob.items || []);
      if (existingJob.job.status === 'running') {
        setIsRunning(true);
      }
    }
  }, [existingJob]);

  // Tick loop when running
  useEffect(() => {
    if (!isRunning || !job?.id || job.status !== 'running') return;

    const interval = setInterval(async () => {
      if (abortRef.current) return;
      try {
        const result = await callOrchestrator('tick', { jobId: job.id });
        if (result.items) setItems(result.items);
        if (result.done) {
          setJob(prev => prev ? { ...prev, status: 'complete' } : null);
          setIsRunning(false);
          qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
        }
      } catch (e: any) {
        console.error('[devseed-backfill tick]', e.message);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isRunning, job?.id, job?.status, projectId, qc]);

  const startBackfill = useCallback(async (opts: {
    pitchIdeaId: string;
    projectId: string;
    lane: string;
    includeDevPack: boolean;
  }) => {
    setError(null);
    abortRef.current = false;
    try {
      const result = await callOrchestrator('enqueue_backfill', opts);
      const jobId = result.job_id;

      // Fetch full status
      const statusResult = await callOrchestrator('status', { jobId });
      setJob(statusResult.job);
      setItems(statusResult.items || []);
      setIsRunning(true);

      return jobId;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, []);

  const pause = useCallback(async () => {
    if (!job) return;
    abortRef.current = true;
    try {
      await callOrchestrator('pause', { jobId: job.id });
      setJob(prev => prev ? { ...prev, status: 'paused' } : null);
      setIsRunning(false);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const resume = useCallback(async () => {
    if (!job) return;
    abortRef.current = false;
    try {
      await callOrchestrator('resume', { jobId: job.id });
      setJob(prev => prev ? { ...prev, status: 'running' } : null);
      setIsRunning(true);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const reset = useCallback(() => {
    abortRef.current = true;
    setJob(null);
    setItems([]);
    setError(null);
    setIsRunning(false);
  }, []);

  return {
    job, items, error, isRunning,
    startBackfill, pause, resume, reset,
  };
}
