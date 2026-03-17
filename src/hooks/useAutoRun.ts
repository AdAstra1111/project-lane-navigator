import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';
import { parseEdgeResponse } from '@/lib/edgeResponseGuard';
import { extractRecoverableAutoRunConflict } from '@/lib/autoRunConflict';
...
async function callAutoRun(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
  });
  // ── IEL: Hardened JSON boundary — never pass HTML/non-JSON to .json() ──
  const result = await parseEdgeResponse(resp, 'auto-run', action);
  // Handle 409 STALE_DECISION gracefully (must parse body only once)
  if (resp.status === 409 && result?.code === 'STALE_DECISION') {
    return { ...result, _stale: true };
  }
  const recoverableConflict = resp.status === 409
    ? extractRecoverableAutoRunConflict(result, extra.projectId)
    : null;
  if (recoverableConflict) {
    return { ...result, ...recoverableConflict, _resumable: true };
  }
  if (resp.status === 409 && (result?.code === 'job_already_running' || result?.recoverable === true || result?.error === 'RESUMABLE_JOB_EXISTS')) {
    throw new Error('Auto-Run conflict received without resumable job data.');
  }
  if (!resp.ok) throw new Error(result.error || result.message || 'Auto-run error');
  return result;
}

export function useAutoRun(projectId: string | undefined) {
  const qc = useQueryClient();
  const [job, setJob] = useState<AutoRunJob | null>(null);
  const [steps, setSteps] = useState<AutoRunStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);
  const runLoopRef = useRef<(jobId: string) => Promise<void>>();

  // Fetch existing job on mount
  const { data: existingJob } = useQuery({
    queryKey: ['auto-run-status', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const result = await callAutoRun('status', { projectId });
      return result;
    },
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (existingJob?.job) {
      setJob(existingJob.job);
      setSteps(existingJob.latest_steps || []);
    }
  }, [existingJob]);

  const start = useCallback(async (mode: string, startDocument: string) => {
    if (!projectId) return;
    setError(null);
    abortRef.current = false;

    const mappedStart = mapDocTypeToLadderStage(startDocument);

    try {
      const result = await callAutoRun('start', {
        projectId,
        mode: 'balanced',
        start_document: mappedStart,
        target_document: 'production_draft',
        allow_defaults: true,
      });

      // Handle RESUMABLE_JOB_EXISTS: auto-resume existing job
      if (result._resumable && result.existing_job_id) {
        console.log(`[useAutoRun][IEL] auto_resume { existing_job_id: "${result.existing_job_id}", current_document: "${result.current_document}" }`);
        const statusResult = await callAutoRun('status', { projectId });
        if (statusResult?.job) {
          setJob(statusResult.job);
          setSteps(statusResult.latest_steps || []);
          await callAutoRun('resume', { jobId: statusResult.job.id, followLatest: true });
          setIsRunning(true);
          runLoopRef.current?.(statusResult.job.id);
          return;
        }
      }

      setJob(result.job);
      setSteps(result.latest_steps || []);
      setIsRunning(true);
      // Invalidate docs immediately — seed pack may have been created during start
      invalidateDevEngine(qc, { projectId, deep: false });
      runLoopRef.current?.(result.job.id);
    } catch (e: any) {
      setError(e.message);
    }
  }, [projectId, qc]);

  const runLoop = useCallback(async (jobId: string) => {
    setIsRunning(true);
    let consecutiveWaits = 0;
    while (!abortRef.current) {
      try {
        // Back off when the server says "wait" (processing lock held)
        const delay = consecutiveWaits > 0 ? Math.min(2000, 500 + consecutiveWaits * 500) : 500;
        await new Promise(r => setTimeout(r, delay));
        const result = await callAutoRun('run-next', { jobId });
        setJob(result.job);
        setSteps(result.latest_steps || []);
        // Refresh doc list + seed versions mid-loop so seed pack chips update live
        qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
        qc.invalidateQueries({ queryKey: ['seed-pack-versions', projectId] });

        const jobStatus = result.job?.status;
        const stopReason = result.job?.stop_reason;
        const hint = result.next_action_hint;

        // If server says "wait" (lock held by another invocation), keep polling
        if (hint === 'wait') {
          consecutiveWaits++;
          continue;
        }
        consecutiveWaits = 0;

        if (
          !result.job ||
          jobStatus !== 'running' ||
          stopReason ||
          jobStatus === 'completed' ||
          jobStatus === 'stopped' ||
          jobStatus === 'failed' ||
          jobStatus === 'paused' ||
          result.job?.awaiting_approval ||
          hint === 'awaiting-approval'
        ) {
          break;
        }
      } catch (e: any) {
        setError(e.message);
        break;
      }
    }
    setIsRunning(false);
    invalidateDevEngine(qc, { projectId, deep: true });
  }, [projectId, qc]);
  runLoopRef.current = runLoop;

  const runNext = useCallback(async () => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('run-next', { jobId: job.id });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const resume = useCallback(async (followLatest?: boolean) => {
    if (!job) return;
    setError(null);
    abortRef.current = false;
    try {
      await callAutoRun('resume', {
        jobId: job.id,
        followLatest: followLatest ?? true,
        pinned_inputs: job.pinned_inputs || {},
      });
      runLoopRef.current?.(job.id);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const pause = useCallback(async () => {
    if (!job) return;
    abortRef.current = true;
    try {
      const result = await callAutoRun('pause', { jobId: job.id });
      setJob(result.job);
      setIsRunning(false);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const stop = useCallback(async () => {
    if (!job) return;
    abortRef.current = true;
    try {
      const result = await callAutoRun('stop', { jobId: job.id });
      setJob(result.job);
      setIsRunning(false);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const approveDecision = useCallback(async (decisionId: string, selectedValue: string) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('approve-decision', { jobId: job.id, decisionId, selectedValue });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result._stale || result.code === 'STALE_DECISION') {
        console.warn('[auto-run] Decision was stale, refreshed job state');
        return;
      }
      // If job resumed to running, start the loop
      if (result.job?.status === 'running') {
        runLoopRef.current?.(result.job.id);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const updateTarget = useCallback(async (ci: number, gp: number) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('update-target', { jobId: job.id, ci, gp });
      setJob(result.job);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const clear = useCallback(() => {
    setJob(null);
    setSteps([]);
    setError(null);
    setIsRunning(false);
    abortRef.current = true;
  }, []);

  const approveSeedCore = useCallback(async () => {
    if (!projectId) return null;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('approve-seed-core', {
        projectId,
        jobId: job?.id,
      });
      if (result.job) {
        setJob(result.job);
        // If job resumed to running, start the loop
        if (result.job.status === 'running') {
          await new Promise(r => setTimeout(r, 300));
          runLoopRef.current?.(result.job.id);
        }
      }
      // Invalidate seed status + docs
      qc.invalidateQueries({ queryKey: ['seed-pack-versions', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
      return result;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [projectId, job, qc]);

  const getPendingDoc = useCallback(async () => {
    if (!job) return null;
    if (!job.awaiting_approval || !job.pending_doc_id) return null;
    try {
      const result = await callAutoRun('get-pending-doc', { jobId: job.id });
      return result.pending_doc || null;
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [job]);

  const approveNext = useCallback(async (decision: 'approve' | 'revise' | 'stop') => {
    if (!job) return;
    if (isRunning) return;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('approve-next', { jobId: job.id, decision });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        await new Promise(r => setTimeout(r, 300));
        runLoopRef.current?.(result.job.id);
      }
    } catch (e: any) {
      if (e.message?.includes('not awaiting approval')) {
        try {
          const status = await callAutoRun('status', { jobId: job.id });
          setJob(status.job);
          setSteps(status.latest_steps || []);
          setIsRunning(status.job?.status === 'running' && !status.job?.awaiting_approval);
        } catch {
          // no-op: stale-state sync best effort
        }
        return;
      }
      setError(e.message);
    }
  }, [job, isRunning]);

  const applyDecisionsAndContinue = useCallback(async (
    selectedOptions: Array<{ note_id: string; option_id: string; custom_direction?: string }>,
    globalDirections?: string[]
  ) => {
    if (!job) return;
    if (isRunning) return;
    // Allow empty selectedOptions — backend will auto-accept if allow_defaults is on
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('apply-decisions-and-continue', {
        jobId: job.id,
        selectedOptions,
        globalDirections,
        source_version_id: job.pending_version_id || undefined,
      });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        await new Promise(r => setTimeout(r, 300));
        runLoopRef.current?.(result.job.id);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [job, isRunning]);

  return { job, steps, isRunning, error, start, runNext, resume, pause, stop, clear, approveDecision, getPendingDoc, approveNext, applyDecisionsAndContinue, approveSeedCore, updateTarget };
}
