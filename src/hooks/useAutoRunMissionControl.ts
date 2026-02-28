import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';

// ── API helper ──
async function callAutoRun(action: string, extra: Record<string, any> = {}) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = `${supabaseUrl}/functions/v1/auto-run`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...extra }),
    });
  } catch (fetchErr: any) {
    throw new Error(`Failed to reach auto-run service (action=${action}, url=${url}): ${fetchErr.message}`);
  }
  const result = await resp.json();
  // Handle 409 STALE_DECISION gracefully (must parse body only once)
  if (resp.status === 409 && result?.code === 'STALE_DECISION') {
    return { ...result, _stale: true };
  }
  if (!resp.ok) throw new Error(result.error || `Auto-run error (${resp.status})`);
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

export type ConnectionState = 'online' | 'reconnecting' | 'disconnected';

export function useAutoRunMissionControl(projectId: string | undefined) {
  const qc = useQueryClient();
  const [job, setJob] = useState<AutoRunJob | null>(null);
  const [steps, setSteps] = useState<AutoRunStep[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('online');
  const abortRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const lastSuccessRef = useRef(Date.now());
  const pollInFlightRef = useRef(false);
  const doPollRef = useRef<() => Promise<void>>();

  // ── Fetch existing job only when user has activated auto-run ──
  const { data: existingJob } = useQuery({
    queryKey: ['auto-run-mission-status', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      return await callAutoRun('status', { projectId });
    },
    enabled: !!projectId && activated,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (existingJob?.job) {
      setJob(existingJob.job);
      setSteps(existingJob.latest_steps || []);
      if (existingJob.job.status === 'running' && !existingJob.job.awaiting_approval) {
        setIsRunning(true);
      } else {
        setIsRunning(false);
      }
    }
  }, [existingJob]);

  // ── Resilient Polling with backoff ──
  const hasPendingDecisions = Array.isArray(job?.pending_decisions) && (job?.pending_decisions as any[]).length > 0;
  const shouldPausePollingForDecisions = job?.status === 'paused' && hasPendingDecisions;

  const schedulePoll = useCallback((delayMs: number) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => {
      pollRef.current = null;
      doPollRef.current?.();
    }, delayMs);
  }, []);

  const jobIdRef = useRef(job?.id);
  jobIdRef.current = job?.id;

  const doPoll = useCallback(async () => {
    if (abortRef.current || pollInFlightRef.current) return;
    const currentJobId = jobIdRef.current;
    if (!currentJobId) return;

    pollInFlightRef.current = true;
    try {
      const result = await callAutoRun('status', { jobId: currentJobId });

      // ── Success path ──
      consecutiveFailuresRef.current = 0;
      lastSuccessRef.current = Date.now();
      setConnectionState('online');
      setError(null);

      setJob(result.job);
      setSteps(result.latest_steps || []);

      const running = !!result.job && result.job.status === 'running' && !result.job.awaiting_approval;
      setIsRunning(running);

      if (!running) {
        return; // Don't reschedule — polling stops
      }

      // If backend idle and still running, nudge run-next
      if (!result.job.is_processing) {
        callAutoRun('run-next', { jobId: result.job.id }).catch((nudgeErr) => {
          console.warn('[auto-run poll] nudge run-next failed:', nudgeErr.message);
        });
      }

      // Schedule next poll — shorter interval when idle to catch dropped chains
      const interval = result.job.is_processing ? 5000 : 3000;
      schedulePoll(interval);

    } catch (e: any) {
      // ── Failure path: DO NOT clear job state or stop running ──
      consecutiveFailuresRef.current += 1;
      const failures = consecutiveFailuresRef.current;
      const timeSinceSuccess = Date.now() - lastSuccessRef.current;

      console.warn(`[auto-run poll] failure #${failures}, ${Math.round(timeSinceSuccess / 1000)}s since last success:`, e.message);

      if (failures >= 10 || timeSinceSuccess > 90_000) {
        setConnectionState('disconnected');
        setError(`Connection lost — retrying (${failures} failures). Backend continues independently.`);
      } else {
        setConnectionState('reconnecting');
      }

      // Exponential backoff: 2s → max 20s + jitter
      const backoff = Math.min(20_000, 2000 * Math.pow(1.5, Math.min(failures, 10))) + Math.random() * 1000;
      schedulePoll(backoff);
    } finally {
      pollInFlightRef.current = false;
    }
  }, [schedulePoll]);

  // Keep ref in sync so schedulePoll always calls latest doPoll
  doPollRef.current = doPoll;

  useEffect(() => {
    // Poll whenever backend job is actively running (job.status is source of truth)
    const shouldPoll = !!job && job.status === 'running' && !job.awaiting_approval && !shouldPausePollingForDecisions;
    if (!shouldPoll) {
      if (isRunning && (!job || job.status !== 'running' || job.awaiting_approval || shouldPausePollingForDecisions)) {
        setIsRunning(false);
      }
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
      return;
    }

    // Reset failure counters when starting fresh polling
    consecutiveFailuresRef.current = 0;
    lastSuccessRef.current = Date.now();
    setConnectionState('online');

    // Kick off first poll
    doPoll();

    return () => { if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; } };
  }, [job?.id, job?.status, job?.awaiting_approval, shouldPausePollingForDecisions, doPoll]);

  // ── Core actions ──
  const refreshStatus = useCallback(async () => {
    if (!job) return;
    try {
      const result = await callAutoRun('status', { jobId: job.id });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch {}
  }, [job]);

  const activate = useCallback(() => setActivated(true), []);

  const start = useCallback(async (mode: string, startDocument: string, targetDocument?: string) => {
    if (!projectId) {
      const msg = 'Cannot start Auto-Run: no project ID';
      setError(msg);
      throw new Error(msg);
    }
    setActivated(true);
    setError(null);
    abortRef.current = false;
    const mappedStart = mapDocTypeToLadderStage(startDocument);
    try {
      const result = await callAutoRun('start', {
        projectId, mode: 'balanced', start_document: mappedStart, target_document: targetDocument || 'production_draft',
        max_total_steps: 100,
      });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      setIsRunning(true);
    } catch (e: any) {
      setError(e.message);
      throw e; // Re-throw so UI callers can catch
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
    // Guard: only call if job is actually awaiting approval with a pending doc
    if (!job.awaiting_approval || !job.pending_doc_id) return null;
    try {
      const result = await callAutoRun('get-pending-doc', { jobId: job.id });
      return result.pending_doc || null;
    } catch (e: any) {
      // Silently handle stale state — job may have moved on
      if (e.message?.includes('No pending document')) return null;
      setError(e.message); return null;
    }
  }, [job]);

  const approveNext = useCallback(async (decision: 'approve' | 'revise' | 'stop') => {
    if (!job) return;
    // Guard: only call if job is actually awaiting approval
    if (!job.awaiting_approval) return;
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
        // Toast handled by UI — no error surfaced
        return;
      }
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
    episode_target_duration_min_seconds?: number;
    episode_target_duration_max_seconds?: number;
    season_episode_count?: number;
    target_runtime_min_low?: number;
    target_runtime_min_high?: number;
  }) => {
    if (!projectId) return;
    const updates: Record<string, any> = {};
    if (quals.episode_target_duration_min_seconds) {
      updates.episode_target_duration_min_seconds = quals.episode_target_duration_min_seconds;
      updates.episode_target_duration_seconds = quals.episode_target_duration_min_seconds; // legacy
    }
    if (quals.episode_target_duration_max_seconds) {
      updates.episode_target_duration_max_seconds = quals.episode_target_duration_max_seconds;
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
    setActivated(false);
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

      let effectiveJob = result?.job ?? null;
      let latestSteps: AutoRunStep[] = [];

      // Fallback sync: some backend responses may not include job payload
      if (!effectiveJob && job?.id) {
        try {
          const status = await callAutoRun('status', { jobId: job.id });
          effectiveJob = status?.job ?? null;
          latestSteps = status?.latest_steps || [];
        } catch {
          // best-effort status sync
        }
      }

      if (effectiveJob) {
        setJob(effectiveJob);
        if (latestSteps.length > 0) setSteps(latestSteps);
        setIsRunning(effectiveJob.status === 'running' && !effectiveJob.awaiting_approval);
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ['seed-pack-versions', projectId] }),
        qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] }),
        qc.invalidateQueries({ queryKey: ['auto-run-mission-status', projectId] }),
      ]);

      return { ...result, job: effectiveJob ?? result?.job ?? null };
    } catch (e: any) {
      setError(e.message);
      return null;
    }
  }, [projectId, job, qc]);

  const applyDecisionsAndContinue = useCallback(async (
    selectedOptions: Array<{ note_id: string; option_id: string; custom_direction?: string }>,
    globalDirections?: string[]
  ) => {
    if (!job) return;
    // Remove isRunning guard — job may show "running" while awaiting_approval
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('apply-decisions-and-continue', {
        jobId: job.id, selectedOptions, globalDirections,
      });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result._stale || result.code === 'STALE_DECISION') {
        console.warn('[auto-run] Decision was stale in applyDecisions, refreshed job state');
        return;
      }
      if (result.job?.status === 'running' && !result.job?.awaiting_approval) {
        setIsRunning(true);
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [job]);

  const updateStepLimit = useCallback(async (newLimit: number) => {
    if (!job) return;
    const HARD_MAX = 1000;
    const clamped = Math.max(1, Math.min(newLimit, HARD_MAX));
    try {
      const result = await callAutoRun('update-step-limit', { jobId: job.id, new_step_limit: clamped });
      if (result.job) setJob(result.job);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const toggleAllowDefaults = useCallback(async (val: boolean) => {
    if (!job) return;
    try {
      await supabase.from('auto_run_jobs').update({ allow_defaults: val }).eq('id', job.id);
      setJob(prev => prev ? { ...prev, allow_defaults: val } : prev);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const resumeFromStepLimit = useCallback(async () => {
    if (!job) return;
    const RESUME_BUMP = 10;
    const HARD_MAX = 1000;
    let newLimit = job.max_total_steps;
    // Always bump if limit <= used so we never get stuck
    if (newLimit <= job.step_count) {
      newLimit = Math.min(job.step_count + RESUME_BUMP, HARD_MAX);
    }
    abortRef.current = false;
    setError(null);
    try {
      // Always update limit to ensure it's above step_count
      await callAutoRun('update-step-limit', { jobId: job.id, new_step_limit: newLimit });
      // Resume — also clear pause_reason
      await callAutoRun('resume', { jobId: job.id, followLatest: true });
      setIsRunning(true);
      refreshStatus();
    } catch (e: any) { setError(e.message); }
  }, [job]);


  return {
    job, steps, isRunning, error, activated, connectionState,
    // Core actions
    start, pause, resume, stop, runNext, clear, refreshStatus, activate,
    // Approval
    getPendingDoc, approveNext, approveDecision, approveSeedCore,
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
    // Step budget
    updateStepLimit, resumeFromStepLimit,
    // Auto-decide
    toggleAllowDefaults,
  };
}
