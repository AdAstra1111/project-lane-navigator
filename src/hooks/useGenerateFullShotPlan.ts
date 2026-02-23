/**
 * useGenerateFullShotPlan — Durable hook backed by shot-plan-jobs edge function.
 * Hydrates from DB on mount; tick-loops through scenes; supports pause/resume/reset/cancel/recover.
 * Hardened: atomic claims, retry-aware, dead-heartbeat recovery.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export interface FullShotPlanCounts {
  pending: number;
  running: number;
  complete: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface FullShotPlanJob {
  id: string;
  project_id: string;
  status: string;
  mode: string;
  total_scenes: number;
  completed_scenes: number;
  inserted_shots: number;
  current_scene_index: number;
  current_scene_id: string | null;
  last_message: string | null;
  last_error: string | null;
  started_at: string;
  finished_at: string | null;
  last_heartbeat_at: string | null;
}

const STAGES = [
  'Preparing scenes',
  'Generating shots',
  'Saving checkpoints',
  'Finalizing',
  'Complete',
];

const TICK_DELAY_MS = 800;

async function callShotPlanApi(action: string, params: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/shot-plan-jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Shot plan API error');
  return data as { job: FullShotPlanJob | null; counts: FullShotPlanCounts | null; sceneResult?: any; message: string };
}

export function useGenerateFullShotPlan(projectId: string | undefined) {
  const qc = useQueryClient();
  const [job, setJob] = useState<FullShotPlanJob | null>(null);
  const [counts, setCounts] = useState<FullShotPlanCounts | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const loopRef = useRef(false);
  const tickTimesRef = useRef<number[]>([]);
  const mountedRef = useRef(true);

  // Derived state
  const stage = !job ? 'idle'
    : job.status === 'running' ? (isLooping ? 'running' : 'starting')
    : job.status === 'paused' ? 'paused'
    : job.status === 'complete' ? 'complete'
    : job.status === 'failed' ? 'failed'
    : job.status === 'canceled' ? 'canceled'
    : 'idle';

  const stageIndex = stage === 'idle' ? 0
    : stage === 'starting' ? 0
    : stage === 'running' ? 1
    : stage === 'complete' ? 4
    : stage === 'paused' ? 1
    : 1;

  const progressPercent = !job || !counts ? 0
    : job.status === 'complete' ? 100
    : counts.total === 0 ? 0
    : Math.min(99, Math.round(((counts.complete + counts.failed + counts.skipped) / counts.total) * 100));

  const avgTickTime = tickTimesRef.current.length > 0
    ? tickTimesRef.current.reduce((a, b) => a + b, 0) / tickTimesRef.current.length / 1000
    : 8;
  const etaSeconds = counts ? Math.max(0, Math.round(avgTickTime * counts.pending)) : 0;

  const detailMessage = job?.last_message || '';

  // Hydrate on mount
  useEffect(() => {
    mountedRef.current = true;
    if (!projectId) return;
    callShotPlanApi('get_active_job', { projectId })
      .then((res) => {
        if (!mountedRef.current) return;
        setJob(res.job);
        setCounts(res.counts);
        if (res.job?.status === 'running') {
          startLoop();
        }
      })
      .catch(() => {});
    return () => { mountedRef.current = false; loopRef.current = false; };
  }, [projectId]);

  // Tick loop
  const startLoop = useCallback(() => {
    if (loopRef.current) return;
    loopRef.current = true;
    setIsLooping(true);

    const loop = async () => {
      while (loopRef.current && mountedRef.current) {
        const tickStart = Date.now();
        try {
          const res = await callShotPlanApi('tick', { projectId });
          if (!mountedRef.current) break;
          setJob(res.job);
          setCounts(res.counts);

          const elapsed = Date.now() - tickStart;
          tickTimesRef.current.push(elapsed);
          if (tickTimesRef.current.length > 10) tickTimesRef.current.shift();

          if (res.job?.status !== 'running') {
            loopRef.current = false;
            break;
          }
        } catch (err: any) {
          console.error('Tick error:', err);
          loopRef.current = false;
          if (mountedRef.current) {
            toast.error('Shot plan tick stopped. You can resume to continue.');
          }
          break;
        }
        await new Promise(r => setTimeout(r, TICK_DELAY_MS));
      }
      if (mountedRef.current) {
        setIsLooping(false);
        qc.invalidateQueries({ queryKey: ['vp-shots', projectId] });
      }
    };
    loop();
  }, [projectId, qc]);

  const stopLoop = useCallback(() => {
    loopRef.current = false;
  }, []);

  const start = useCallback(async (mode: string = 'coverage') => {
    if (!projectId) return;
    try {
      const res = await callShotPlanApi('create_job', { projectId, mode });
      setJob(res.job);
      setCounts(res.counts);
      if (res.job?.status === 'running') {
        startLoop();
        toast.success('Full shot plan started');
      } else {
        toast.info(res.message);
      }
    } catch (err: any) {
      toast.error(`Start failed: ${err.message}`);
    }
  }, [projectId, startLoop]);

  const pause = useCallback(async () => {
    if (!projectId) return;
    stopLoop();
    try {
      const res = await callShotPlanApi('pause_job', { projectId });
      setJob(res.job);
      setCounts(res.counts);
      toast.info('Shot plan paused');
    } catch (err: any) {
      toast.error(`Pause failed: ${err.message}`);
    }
  }, [projectId, stopLoop]);

  const resume = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await callShotPlanApi('resume_job', { projectId });
      setJob(res.job);
      setCounts(res.counts);
      if (res.job?.status === 'running') {
        startLoop();
        toast.success('Shot plan resumed');
      }
    } catch (err: any) {
      toast.error(`Resume failed: ${err.message}`);
    }
  }, [projectId, startLoop]);

  const cancel = useCallback(async () => {
    if (!projectId) return;
    stopLoop();
    try {
      const res = await callShotPlanApi('cancel_job', { projectId });
      setJob(res.job);
      setCounts(res.counts);
      toast.info('Shot plan canceled');
      qc.invalidateQueries({ queryKey: ['vp-shots', projectId] });
    } catch (err: any) {
      toast.error(`Cancel failed: ${err.message}`);
    }
  }, [projectId, stopLoop, qc]);

  const reset = useCallback(async (mode: string = 'coverage') => {
    if (!projectId) return;
    stopLoop();
    try {
      const res = await callShotPlanApi('reset_job', { projectId, mode });
      setJob(res.job);
      setCounts(res.counts);
      tickTimesRef.current = [];
      if (res.job?.status === 'running') {
        startLoop();
        toast.success('Shot plan reset and restarted');
      }
    } catch (err: any) {
      toast.error(`Reset failed: ${err.message}`);
    }
  }, [projectId, stopLoop, startLoop]);

  const recover = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await callShotPlanApi('recover_job', { projectId });
      setJob(res.job);
      setCounts(res.counts);
      if (res.job?.status === 'running') {
        startLoop();
        toast.success('Shot plan recovered');
      }
    } catch (err: any) {
      toast.error(`Recovery failed: ${err.message}`);
    }
  }, [projectId, startLoop]);

  return {
    job,
    counts,
    stage,
    stages: STAGES,
    stageIndex,
    progressPercent,
    etaSeconds,
    detailMessage,
    isRunning: isLooping,
    isPaused: stage === 'paused',
    isComplete: stage === 'complete',
    isFailed: stage === 'failed',
    isCanceled: stage === 'canceled',
    actions: { start, pause, resume, reset, cancel, recover },
  };
}
