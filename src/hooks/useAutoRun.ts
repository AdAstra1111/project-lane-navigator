import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PendingDecision {
  id: string;
  question: string;
  options: { value: string; why: string }[];
  recommended?: string;
  impact: 'blocking' | 'non_blocking';
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

    const LADDER_MAP: Record<string, string> = {
      idea: 'idea',
      concept_brief: 'concept_brief',
      market_sheet: 'concept_brief',
      blueprint: 'blueprint',
      architecture: 'architecture',
      character_bible: 'blueprint',
      beat_sheet: 'architecture',
      script: 'draft',
      production_draft: 'draft',
      deck: 'concept_brief',
      documentary_outline: 'blueprint',
    };
    const mappedStart = LADDER_MAP[startDocument] || 'idea';

    const MODE_STEPS: Record<string, number> = { fast: 8, balanced: 12, premium: 18 };

    try {
      const result = await callAutoRun('start', {
        projectId,
        mode,
        start_document: mappedStart,
        target_document: 'draft',
        max_total_steps: MODE_STEPS[mode] || 12,
      });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      setIsRunning(true);
      runLoop(result.job.id);
    } catch (e: any) {
      setError(e.message);
    }
  }, [projectId]);

  const runLoop = useCallback(async (jobId: string) => {
    setIsRunning(true);
    let attempts = 0;
    while (!abortRef.current && attempts < 50) {
      attempts++;
      try {
        await new Promise(r => setTimeout(r, 500));
        const result = await callAutoRun('run-next', { jobId });
        setJob(result.job);
        setSteps(result.latest_steps || []);

        if (!result.job || !['running'].includes(result.job.status)) {
          break;
        }
        // Stop polling if awaiting approval
        if (result.job?.awaiting_approval || result.next_action_hint === 'awaiting-approval') {
          break;
        }
      } catch (e: any) {
        setError(e.message);
        break;
      }
    }
    setIsRunning(false);
    qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
  }, [projectId, qc]);

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

  const resume = useCallback(async () => {
    if (!job) return;
    setError(null);
    abortRef.current = false;
    try {
      await callAutoRun('resume', { jobId: job.id });
      runLoop(job.id);
    } catch (e: any) {
      setError(e.message);
    }
  }, [job, runLoop]);

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
      // If job resumed to running, start the loop
      if (result.job?.status === 'running') {
        runLoop(result.job.id);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [job, runLoop]);

  const clear = useCallback(() => {
    setJob(null);
    setSteps([]);
    setError(null);
    setIsRunning(false);
    abortRef.current = true;
  }, []);

  const getPendingDoc = useCallback(async () => {
    if (!job) return null;
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
    if (isRunning) return; // prevent duplicate calls while loop is active
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('approve-next', { jobId: job.id, decision });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        // Small delay to avoid race with any lingering poll
        await new Promise(r => setTimeout(r, 300));
        runLoop(result.job.id);
      }
    } catch (e: any) {
      // Ignore "not awaiting approval" if already processed
      if (e.message?.includes('not awaiting approval')) return;
      setError(e.message);
    }
  }, [job, runLoop, isRunning]);

  return { job, steps, isRunning, error, start, runNext, resume, pause, stop, clear, approveDecision, getPendingDoc, approveNext };
}
