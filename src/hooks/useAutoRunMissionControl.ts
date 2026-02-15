import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';

// ── API helper ──
async function callAutoRun(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ action, ...extra }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Auto-run error');
  return result;
}

async function callDocumentText(documentId?: string, versionId?: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/document-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ documentId, versionId }),
  });
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Document text error');
  return result;
}

export interface DocumentTextResult {
  plaintext: string;
  extracted_text: string;
  doc_type: string;
  version_number: number;
  char_count: number;
}

export function useAutoRunMissionControl(projectId: string | undefined) {
  const qc = useQueryClient();
  const [job, setJob] = useState<AutoRunJob | null>(null);
  const [steps, setSteps] = useState<AutoRunStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch existing job ──
  const { data: existingJob } = useQuery({
    queryKey: ['auto-run-mission-status', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      return await callAutoRun('status', { projectId });
    },
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (existingJob?.job) {
      setJob(existingJob.job);
      setSteps(existingJob.latest_steps || []);
      if (existingJob.job.status === 'running' && !existingJob.job.awaiting_approval) {
        setIsRunning(true);
      }
    }
  }, [existingJob]);

  // ── Polling ──
  useEffect(() => {
    if (!job || !isRunning) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    if (job.awaiting_approval || job.status !== 'running') {
      setIsRunning(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }

    const poll = async () => {
      if (abortRef.current) return;
      try {
        const result = await callAutoRun('run-next', { jobId: job.id });
        setJob(result.job);
        setSteps(result.latest_steps || []);
        if (!result.job || !['running'].includes(result.job.status)) {
          setIsRunning(false);
        }
        if (result.job?.awaiting_approval || result.next_action_hint === 'awaiting-approval') {
          setIsRunning(false);
        }
      } catch (e: any) {
        setError(e.message);
        setIsRunning(false);
      }
    };

    pollRef.current = setInterval(poll, 3000);
    // Run immediately too
    poll();

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [job?.id, isRunning, job?.status, job?.awaiting_approval]);

  // ── Core actions ──
  const refreshStatus = useCallback(async () => {
    if (!job) return;
    try {
      const result = await callAutoRun('status', { jobId: job.id });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch {}
  }, [job]);

  const start = useCallback(async (mode: string, startDocument: string) => {
    if (!projectId) return;
    setError(null);
    abortRef.current = false;
    const LADDER_MAP: Record<string, string> = {
      idea: 'idea', concept_brief: 'concept_brief', market_sheet: 'concept_brief',
      blueprint: 'blueprint', architecture: 'architecture', character_bible: 'blueprint',
      beat_sheet: 'architecture', script: 'draft', production_draft: 'draft',
      deck: 'concept_brief', documentary_outline: 'blueprint',
    };
    const mappedStart = LADDER_MAP[startDocument] || 'idea';
    const MODE_STEPS: Record<string, number> = { fast: 8, balanced: 12, premium: 18 };
    try {
      const result = await callAutoRun('start', {
        projectId, mode, start_document: mappedStart, target_document: 'draft',
        max_total_steps: MODE_STEPS[mode] || 12,
      });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      setIsRunning(true);
    } catch (e: any) {
      setError(e.message);
    }
  }, [projectId]);

  const pause = useCallback(async () => {
    if (!job) return;
    abortRef.current = true;
    try {
      const result = await callAutoRun('pause', { jobId: job.id });
      setJob(result.job);
      setIsRunning(false);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const resume = useCallback(async (followLatest?: boolean) => {
    if (!job) return;
    abortRef.current = false;
    setError(null);
    try {
      await callAutoRun('resume', { jobId: job.id, ...(followLatest !== undefined ? { followLatest } : {}) });
      setIsRunning(true);
      refreshStatus();
    } catch (e: any) { setError(e.message); }
  }, [job, refreshStatus]);

  const setResumeSource = useCallback(async (documentId: string, versionId: string) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('set-resume-source', { jobId: job.id, documentId, versionId });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const stop = useCallback(async () => {
    if (!job) return;
    abortRef.current = true;
    try {
      const result = await callAutoRun('stop', { jobId: job.id });
      setJob(result.job);
      setIsRunning(false);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const runNext = useCallback(async () => {
    if (!job) return;
    try {
      const result = await callAutoRun('run-next', { jobId: job.id });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  // ── Approval ──
  const getPendingDoc = useCallback(async () => {
    if (!job) return null;
    try {
      const result = await callAutoRun('get-pending-doc', { jobId: job.id });
      return result.pending_doc || null;
    } catch (e: any) { setError(e.message); return null; }
  }, [job]);

  const approveNext = useCallback(async (decision: 'approve' | 'revise' | 'stop') => {
    if (!job || isRunning) return;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('approve-next', { jobId: job.id, decision });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        await new Promise(r => setTimeout(r, 300));
        setIsRunning(true);
      }
    } catch (e: any) {
      if (e.message?.includes('not awaiting approval')) return;
      setError(e.message);
    }
  }, [job, isRunning]);

  const approveDecision = useCallback(async (decisionId: string, selectedValue: string) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('approve-decision', { jobId: job.id, decisionId, selectedValue });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        setIsRunning(true);
      }
    } catch (e: any) { setError(e.message); }
  }, [job]);

  // ── Stage control ──
  const setStage = useCallback(async (stage: string) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('set-stage', { jobId: job.id, stage });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const forcePromote = useCallback(async () => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('force-promote', { jobId: job.id });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') setIsRunning(true);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const restartFromStage = useCallback(async (stage: string) => {
    if (!job) return;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('restart-from-stage', { jobId: job.id, stage });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') setIsRunning(true);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  // ── Intervention saves ──
  const saveStorySetup = useCallback(async (storySetup: Record<string, string>) => {
    if (!projectId) return;
    const { data: proj } = await supabase.from('projects').select('guardrails_config').eq('id', projectId).single();
    const gc = (proj?.guardrails_config as any) || {};
    gc.overrides = gc.overrides || {};
    gc.overrides.story_setup = storySetup;
    await supabase.from('projects').update({ guardrails_config: gc }).eq('id', projectId);
  }, [projectId]);

  const saveQualifications = useCallback(async (quals: {
    episode_target_duration_seconds?: number;
    season_episode_count?: number;
    target_runtime_min_low?: number;
    target_runtime_min_high?: number;
  }) => {
    if (!projectId) return;
    const updates: Record<string, any> = {};
    if (quals.episode_target_duration_seconds) {
      updates.episode_target_duration_seconds = quals.episode_target_duration_seconds;
    }
    const { data: proj } = await supabase.from('projects').select('guardrails_config').eq('id', projectId).single();
    const gc = (proj?.guardrails_config as any) || {};
    gc.overrides = gc.overrides || {};
    gc.overrides.qualifications = { ...(gc.overrides.qualifications || {}), ...quals };
    updates.guardrails_config = gc;
    await supabase.from('projects').update(updates).eq('id', projectId);
  }, [projectId]);

  const saveLaneBudget = useCallback(async (lane: string, budget: string) => {
    if (!projectId) return;
    await supabase.from('projects').update({ assigned_lane: lane, budget_range: budget }).eq('id', projectId);
  }, [projectId]);

  const saveGuardrails = useCallback(async (guardrails: any) => {
    if (!projectId) return;
    await supabase.from('projects').update({ guardrails_config: guardrails }).eq('id', projectId);
  }, [projectId]);

  // ── Document text helper ──
  const fetchDocumentText = useCallback(async (documentId?: string, versionId?: string): Promise<DocumentTextResult | null> => {
    try {
      return await callDocumentText(documentId, versionId);
    } catch { return null; }
  }, []);

  const clear = useCallback(() => {
    setJob(null);
    setSteps([]);
    setError(null);
    setIsRunning(false);
    abortRef.current = true;
  }, []);

  const applyDecisionsAndContinue = useCallback(async (
    selectedOptions: Array<{ note_id: string; option_id: string; custom_direction?: string }>,
    globalDirections?: string[]
  ) => {
    if (!job) return;
    if (isRunning) return;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('apply-decisions-and-continue', {
        jobId: job.id, selectedOptions, globalDirections,
      });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        setIsRunning(true);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [job, isRunning]);

  return {
    job, steps, isRunning, error,
    // Core actions
    start, pause, resume, stop, runNext, clear, refreshStatus,
    // Approval
    getPendingDoc, approveNext, approveDecision,
    // Decisions
    applyDecisionsAndContinue,
    // Stage control
    setStage, forcePromote, restartFromStage,
    // Resume source
    setResumeSource,
    // Interventions
    saveStorySetup, saveQualifications, saveLaneBudget, saveGuardrails,
    // Document text
    fetchDocumentText,
  };
}
