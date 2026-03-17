import { useState, useCallback, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { AutoRunJob, AutoRunStep } from '@/hooks/useAutoRun';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';
import { AUTO_RUN_EXECUTION_MODE } from '@/lib/autoRunConfig';
import { parseEdgeResponse } from '@/lib/edgeResponseGuard';
import { extractRecoverableAutoRunConflict } from '@/lib/autoRunConflict';

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
  if (!resp.ok) throw new Error(result.error || result.message || `Auto-run error (${resp.status})`);
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
  const result = await parseEdgeResponse(resp, 'document-text');
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

// ── Human-required pause reasons that must NOT be auto-resumed ──
const HUMAN_REQUIRED_PAUSES = [
  'COMPLETED', 'ERROR', 'VERSION_CAP_REACHED',
  'SAFE_MODE_GATE', 'STEP_LIMIT_REACHED',
  'EXCEPTIONAL_PLATEAU_ESCALATION',
];

function isHumanRequiredPause(job: AutoRunJob): boolean {
  if (HUMAN_REQUIRED_PAUSES.some(r =>
    job.stop_reason?.includes(r) || job.pause_reason?.includes(r)
  )) return true;
  if (job.awaiting_approval && (job as any).approval_type === 'human_required') return true;
  return false;
}

function buildPauseLoopSignature(job: AutoRunJob): string {
  return [
    job.id,
    job.current_document,
    job.pause_reason || '',
    String(job.step_count ?? ''),
    String(job.last_ci ?? ''),
    String(job.stage_loop_count ?? ''),
  ].join('|');
}

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
  const autoResumeFailCountRef = useRef(0);
  const autoResumeInFlightRef = useRef(false);
  const autoResumeLastAttemptSignatureRef = useRef<string | null>(null);
  const lastSuccessRef = useRef(Date.now());
  const pollInFlightRef = useRef(false);
  const doPollRef = useRef<() => Promise<void>>();

  // Auto-activate Mission Control on entry so controls/status are always available
  useEffect(() => {
    if (projectId) setActivated(true);
  }, [projectId]);

  // Reset local mission state when project changes (prevents cross-project bleed)
  useEffect(() => {
    abortRef.current = false;
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    consecutiveFailuresRef.current = 0;
    autoResumeFailCountRef.current = 0;
    autoResumeInFlightRef.current = false;
    autoResumeLastAttemptSignatureRef.current = null;
    lastSuccessRef.current = Date.now();
    setJob(null);
    setSteps([]);
    setIsRunning(false);
    setError(null);
    setConnectionState('online');
  }, [projectId]);

  // ── Fetch existing job when mission control is activated ──
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
      console.log(`[mission-control][IEL] job_rehydrate { job_id: "${existingJob.job.id}", status: "${existingJob.job.status}", current_document: "${existingJob.job.current_document}", step_count: ${existingJob.job.step_count} }`);
      if (existingJob.job.status === 'running' && !existingJob.job.awaiting_approval) {
        setIsRunning(true);
      } else {
        setIsRunning(false);
      }
    }
  }, [existingJob]);

  // Discover jobs started from other panels (keeps Clean/Advanced in sync)
  useEffect(() => {
    if (!projectId || !activated || job?.id) return;

    let cancelled = false;
    const discover = async () => {
      try {
        const result = await callAutoRun('status', { projectId });
        if (cancelled || !result?.job) return;
        setJob(result.job);
        setSteps(result.latest_steps || []);
        setIsRunning(result.job.status === 'running' && !result.job.awaiting_approval);
      } catch {
        // no active job yet
      }
    };

    discover();
    const interval = setInterval(discover, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId, activated, job?.id]);

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

      // Refresh document tray + version lists on every poll so auto-run-created docs/versions appear immediately
      qc.invalidateQueries({ queryKey: ['dev-v2-docs', projectId] });
      qc.invalidateQueries({ queryKey: ['dev-v2-versions'] });
      qc.invalidateQueries({ queryKey: ['dev-v2-approved', projectId] });
      qc.invalidateQueries({ queryKey: ['seed-pack-versions', projectId] });

      const running = !!result.job && result.job.status === 'running' && !result.job.awaiting_approval;
      const isPausedAutoResumable = !!result.job && result.job.status === 'paused' && result.job.allow_defaults === true && !isHumanRequiredPause(result.job) && autoResumeFailCountRef.current < 3;

      // During auto-resumable pauses, keep showing "Running" in UI
      setIsRunning(running || isPausedAutoResumable);

      if (!running && !isPausedAutoResumable) {
        return; // Don't reschedule — polling stops
      }

      // If backend idle and still running, nudge run-next
      // IMPORTANT: do not nudge paused jobs here (auto-resume effect handles those)
      if (running && !result.job.is_processing) {
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

  // ── Auto-resume effect: when paused + allow_defaults, resume automatically ──
  useEffect(() => {
    if (!job) return;

    if (job.status !== 'paused') {
      // Clear snapshot guard outside paused state so next real pause can be handled
      autoResumeLastAttemptSignatureRef.current = null;
      // Reset failed attempts once we leave pause (completed / running / stopped / failed)
      if (['running', 'completed', 'stopped', 'failed'].includes(job.status)) {
        autoResumeFailCountRef.current = 0;
      }
      return;
    }

    if (!job.allow_defaults) return;
    if (isHumanRequiredPause(job)) return;
    if (autoResumeFailCountRef.current >= 3) {
      setIsRunning(false);
      return;
    }
    if (autoResumeInFlightRef.current) return;

    const pauseSignature = buildPauseLoopSignature(job);
    // Prevent duplicate scheduling for the same paused snapshot
    if (autoResumeLastAttemptSignatureRef.current === pauseSignature) return;
    autoResumeLastAttemptSignatureRef.current = pauseSignature;

    console.log(`[mission-control][IEL] auto_resume_scheduled { job_id: "${job.id}", pause_reason: "${job.pause_reason}", attempt: ${autoResumeFailCountRef.current + 1} }`);

    const timer = setTimeout(async () => {
      autoResumeInFlightRef.current = true;
      try {
        const resumeResult = await callAutoRun('resume', { jobId: job.id, followLatest: true });
        if (resumeResult?.job) {
          setJob(resumeResult.job);
          setSteps(resumeResult.latest_steps || []);
        }

        // Nudge run-next immediately after resume
        const nextResult = await callAutoRun('run-next', { jobId: job.id });
        if (nextResult?.job) {
          setJob(nextResult.job);
          setSteps(nextResult.latest_steps || []);
        }

        const postJob = nextResult?.job || resumeResult?.job || null;
        if (postJob?.status === 'paused' && buildPauseLoopSignature(postJob) === pauseSignature) {
          autoResumeFailCountRef.current += 1;
          console.warn(`[mission-control] auto-resume stalled (attempt ${autoResumeFailCountRef.current}) for ${postJob.current_document}: ${postJob.pause_reason}`);
          if (autoResumeFailCountRef.current >= 3) {
            setIsRunning(false);
          }
          return;
        }

        // Successful progress (status changed and/or pause signature changed)
        autoResumeFailCountRef.current = 0;
        autoResumeLastAttemptSignatureRef.current = null;
        setIsRunning(postJob?.status === 'running');
        console.log(`[mission-control][IEL] auto_resume_success { job_id: "${job.id}" }`);
      } catch (e: any) {
        autoResumeFailCountRef.current += 1;
        // Allow retry for the same paused snapshot on transient failures
        autoResumeLastAttemptSignatureRef.current = null;
        console.warn(`[mission-control] auto-resume failed (attempt ${autoResumeFailCountRef.current}):`, e.message);
        if (autoResumeFailCountRef.current >= 3) {
          setIsRunning(false);
        }
      } finally {
        autoResumeInFlightRef.current = false;
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [job?.id, job?.status, job?.allow_defaults, job?.pause_reason, job?.stop_reason, job?.step_count, job?.last_ci, job?.stage_loop_count]);

  useEffect(() => {
    // Poll when backend job is actively running OR when paused-but-auto-resumable (allow_defaults ON)
    const isPausedAutoResumable = !!job && job.status === 'paused' && job.allow_defaults === true && !isHumanRequiredPause(job) && autoResumeFailCountRef.current < 3;
    const shouldPoll = (!!job && job.status === 'running' && !job.awaiting_approval && !shouldPausePollingForDecisions) || isPausedAutoResumable;

    if (!shouldPoll) {
      if (isRunning && (!job || (job.status !== 'running' && !isPausedAutoResumable) || job.awaiting_approval || shouldPausePollingForDecisions)) {
        setIsRunning(false);
      }
      if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
      return;
    }

    // Keep isRunning true during auto-resumable pauses so UI shows "Running" not "Paused"
    if (isPausedAutoResumable && !isRunning) {
      setIsRunning(true);
    }

    // Reset failure counters when starting fresh polling
    consecutiveFailuresRef.current = 0;
    lastSuccessRef.current = Date.now();
    setConnectionState('online');

    // Kick off first poll
    doPoll();

    return () => { if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; } };
  }, [job?.id, job?.status, job?.awaiting_approval, job?.allow_defaults, shouldPausePollingForDecisions, doPoll]);

  // ── Core actions ──
  const refreshStatus = useCallback(async (preferredJobId?: string) => {
    const lookupJobId = preferredJobId || job?.id;
    if (!lookupJobId && !projectId) return;
    try {
      const result = await callAutoRun('status', lookupJobId ? { jobId: lookupJobId, projectId } : { projectId });
      setJob(result.job);
      setSteps(result.latest_steps || []);
    } catch {}
  }, [job?.id, projectId]);

  const activate = useCallback(() => setActivated(true), []);

  const start = useCallback(async (mode: string, startDocument: string, targetDocument?: string, allowDefaults?: boolean) => {
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
      // Preflight: avoid 409 by resuming any existing resumable job first.
      try {
        const existing = await callAutoRun('status', { projectId });
        if (existing?.job && ['paused', 'running', 'queued'].includes(existing.job.status)) {
          console.log(`[mission-control][IEL] start_vs_resume_decision { action: "preflight_resume", reason: "job_already_running", existing_job_id: "${existing.job.id}", current_document: "${existing.job.current_document}", step_count: ${existing.job.step_count} }`);
          setJob(existing.job);
          setSteps(existing.latest_steps || []);

          if (existing.job.status === 'paused') {
            await callAutoRun('resume', { jobId: existing.job.id, followLatest: true });
          }

          setIsRunning(true);
          await refreshStatus(existing.job.id);
          return;
        }
      } catch {
        // No resumable job found — continue with normal start path.
      }

      const result = await callAutoRun('start', {
        projectId, mode: AUTO_RUN_EXECUTION_MODE === 'full' ? 'balanced' : 'staged', start_document: mappedStart, target_document: targetDocument || 'production_draft',
        max_total_steps: 100,
        allow_defaults: allowDefaults ?? false,
        max_versions_per_doc_per_job: 60,
      });

      const existingJobId = result.job_id || result.existing_job_id;
      if (result._resumable && existingJobId) {
        console.log(`[mission-control][IEL] start_vs_resume_decision { action: "auto_attach_existing_job", reason: "job_already_running", existing_job_id: "${existingJobId}", current_document: "${result.current_document}", step_count: ${result.step_count} }`);
        try {
          const statusResult = await callAutoRun('status', { jobId: existingJobId, projectId });
          if (statusResult?.job) {
            setJob(statusResult.job);
            setSteps(statusResult.latest_steps || []);
            if (statusResult.job.status === 'paused') {
              await callAutoRun('resume', { jobId: statusResult.job.id, followLatest: true });
            }
            setIsRunning(true);
            await refreshStatus(statusResult.job.id);
            return;
          }
        } catch (resumeErr: any) {
          console.warn('[mission-control][IEL] reattach_fallback', resumeErr.message);
          // Fallback: use the conflict payload directly instead of crashing
          setJob({ id: existingJobId, status: result.status || 'running', current_document: result.current_document, step_count: result.step_count ?? 0, project_id: projectId } as any);
          setIsRunning(true);
          return;
        }
      }

      setJob(result.job);
      setSteps(result.latest_steps || []);
      setIsRunning(true);
      console.log(`[mission-control][IEL] start_new_job { job_id: "${result.job?.id}", current_document: "${result.job?.current_document}" }`);
    } catch (e: any) {
      setError(e.message);
      // Don't re-throw — let the UI show the error gracefully instead of blank screen
    }
  }, [projectId, refreshStatus]);

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

  const applyingDecisionsRef = useRef(false);

  const applyDecisionsAndContinue = useCallback(async (
    selectedOptions: Array<{ note_id: string; option_id: string; custom_direction?: string }>,
    globalDirections?: string[]
  ) => {
    if (!job) return;
    if (applyingDecisionsRef.current) {
      console.warn('[auto-run] applyDecisionsAndContinue already in flight — skipping');
      return;
    }
    applyingDecisionsRef.current = true;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('apply-decisions-and-continue', {
        jobId: job.id, selectedOptions, globalDirections,
        source_version_id: job.pending_version_id || job.frontier_version_id || undefined,
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
    } finally {
      applyingDecisionsRef.current = false;
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

  const updateTarget = useCallback(async (ci: number, gp: number) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('update-target', { jobId: job.id, ci, gp });
      if (result.job) setJob(result.job);
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const toggleAllowDefaults = useCallback(async (val: boolean) => {
    if (!job) return;
    try {
      await supabase.from('auto_run_jobs').update({ allow_defaults: val } as any).eq('id', job.id);
      setJob(prev => prev ? { ...prev, allow_defaults: val } : prev);

      // When enabling auto-decide while paused with pending decisions, auto-resolve them
      // Use the in-flight guard to prevent racing with the button
      const hasPending = Array.isArray(job.pending_decisions) && (job.pending_decisions as any[]).length > 0;
      if (val && job.status === 'paused' && hasPending && !applyingDecisionsRef.current) {
        // Small delay to let any concurrent button click claim the lock first
        await new Promise(r => setTimeout(r, 200));
        if (applyingDecisionsRef.current) return; // button click took priority
        applyingDecisionsRef.current = true;
        try {
          const result = await callAutoRun('apply-decisions-and-continue', {
            jobId: job.id,
            selectedOptions: [],
            source_version_id: job.pending_version_id || job.frontier_version_id || undefined,
          });
          if (result.job) {
            setJob(result.job);
            setSteps(result.latest_steps || []);
            if (result.job.status === 'running') {
              setIsRunning(true);
            }
          }
        } catch (resumeErr: any) {
          console.warn('[auto-run] auto-resolve pending decisions failed:', resumeErr.message);
        } finally {
          applyingDecisionsRef.current = false;
        }
      }
    } catch (e: any) { setError(e.message); }
  }, [job]);

  const updateVersionCap = useCallback(async (newCap: number) => {
    if (!job) return;
    setError(null);
    try {
      const result = await callAutoRun('update-version-cap', { jobId: job.id, max_versions_per_doc_per_job: newCap });
      if (result.job) setJob(result.job);
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

  const repairBaseline = useCallback(async (strategy: 'promote_best_scored' | 'promote_latest') => {
    if (!job) return;
    setError(null);
    abortRef.current = false;
    try {
      const result = await callAutoRun('repair-baseline', { jobId: job.id, strategy });
      setJob(result.job);
      setSteps(result.latest_steps || []);
      if (result.job?.status === 'running') {
        setIsRunning(true);
      }
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
    // Version cap
    updateVersionCap,
    // Auto-decide
    toggleAllowDefaults,
    // Target
    updateTarget,
    // Baseline repair
    repairBaseline,
  };
}
