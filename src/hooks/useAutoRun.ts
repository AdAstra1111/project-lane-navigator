import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';

export interface PendingDecision {
  id: string;
  question: string;
  options: { value: string; why: string }[];
  recommended?: string;
  impact: 'blocking' | 'non_blocking';
}

export interface AutoRunStageHistoryEntry {
  doc_type: string;
  base_version_id: string | null;
  output_version_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: 'completed' | 'failed' | 'skipped' | 'in_progress';
}

export interface AutoRunJob {
  id: string;
  user_id: string;
  project_id: string;
  status: 'queued' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
  mode: 'fast' | 'balanced' | 'premium';
  start_document: string;
  target_document: string;
  current_document: string;
  max_stage_loops: number;
  max_total_steps: number;
  step_count: number;
  stage_loop_count: number;
  last_ci: number | null;
  last_gp: number | null;
  last_gap: number | null;
  last_readiness: number | null;
  last_confidence: number | null;
  last_risk_flags: string[];
  stop_reason: string | null;
  error: string | null;
  pending_decisions: PendingDecision[] | null;
  awaiting_approval: boolean;
  approval_type: string | null;
  approval_payload: any;
  pending_doc_id: string | null;
  pending_version_id: string | null;
  pending_doc_type: string | null;
  pending_next_doc_type: string | null;
  follow_latest: boolean;
  resume_document_id: string | null;
  resume_version_id: string | null;
  // Stage 6.9: pipeline-aware fields
  pipeline_key: string | null;
  current_stage_index: number;
  stage_history: AutoRunStageHistoryEntry[];
  pinned_inputs: Record<string, string>;
  last_ui_message: string | null;
  approval_required_for_doc_type: string | null;
  pause_reason: string | null;
  converge_target_json: { ci: number; gp: number };
  stage_exhaustion_remaining: number;
  stage_exhaustion_default: number;
  allow_defaults: boolean;
  is_processing: boolean;
  processing_started_at: string | null;
  // Frontier exploration fields
  frontier_version_id: string | null;
  best_document_id: string | null;
  frontier_ci: number | null;
  frontier_gp: number | null;
  frontier_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface AutoRunStep {
  id: string;
  job_id: string;
  step_index: number;
  document: string;
  action: string;
  summary: string | null;
  ci: number | null;
  gp: number | null;
  gap: number | null;
  readiness: number | null;
  confidence: number | null;
  risk_flags: string[];
  output_text: string | null;
  output_ref: any;
  created_at: string;
}

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
  const result = await resp.json();
  // Handle 409 STALE_DECISION gracefully (must parse body only once)
  if (resp.status === 409 && result?.code === 'STALE_DECISION') {
    return { ...result, _stale: true };
  }
  if (!resp.ok) throw new Error(result.error || 'Auto-run error');
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
      });
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
