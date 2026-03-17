/**
 * AutopilotPanel — "Project Autopilot" orchestration panel.
 *
 * Phase 0: Ensure writing voice (deterministic default if missing)
 * Phase 1: DevSeed (apply_seed_intel_pack + regen_foundation)
 * Phase 2: Auto-Run ladder (start on DevSeed completion, show status)
 *
 * GATES: All progression-affecting gates are DB-persisted or derived from DB.
 * - handoff is DB-driven (checks autoRunJob existence + devseed status)
 * - awaiting_approval / pending_decisions surfaced as blocking UI
 * - allow_defaults=true passed explicitly at start
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { AutopilotProgress, type AutopilotState } from '@/components/pitch/AutopilotProgress';
import { Loader2, Play, Pause, Rocket, AlertTriangle, Mic, Search, ExternalLink, CheckCircle, Clock, ArrowRight, FileText, Zap } from 'lucide-react';
import { getDefaultVoiceForLane } from '@/lib/writingVoices/select';
import { loadProjectLaneRulesetPrefs, saveProjectLaneRulesetPrefs } from '@/lib/rulesets/uiState';
import { parseEdgeResponse } from '@/lib/edgeResponseGuard';
import { extractRecoverableAutoRunConflict } from '@/lib/autoRunConflict';

interface Props {
  projectId: string;
  pitchIdeaId?: string | null;
  lane?: string | null;
  format?: string | null;
  documents?: Array<{ id: string; doc_type: string }>;
  approvedVersionMap?: Record<string, any>;
  onSelectDocument?: (docId: string) => void;
  /** External auto-run job from shared hook — keeps Clean/Advanced views in sync */
  externalAutoRunJob?: any;
}

// ─── Auto-Run caller (mirrors canonical pattern from useAutoRun.ts) ───
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
  const result = await parseEdgeResponse(resp, 'auto-run', action);
  // Handle 409 STALE_DECISION gracefully
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

// ─── Canon baseline populator (uses dev-engine-v2 LLM action, not UI heuristics) ───
async function populateCanonBaseline(projectId: string): Promise<boolean> {
  try {
    // Step 1: Ensure canon row exists via canonical initialize
    await supabase.functions.invoke('dev-engine-v2', {
      body: { action: 'canon_os_initialize', projectId },
    });

    // Step 2: Extract canon fields from seed docs via single LLM pass
    const { data, error } = await supabase.functions.invoke('dev-engine-v2', {
      body: { action: 'canon_os_extract_from_seed_docs', projectId },
    });

    if (error) {
      console.warn('[ProjectAutopilot] canon extraction error (non-fatal):', error.message);
      return false;
    }

    return data?.updated === true;
  } catch (err) {
    console.warn('[ProjectAutopilot] canon baseline population failed (non-fatal):', err);
    return false;
  }
}

export function AutopilotPanel({ projectId, pitchIdeaId, lane, format, documents, approvedVersionMap, onSelectDocument, externalAutoRunJob }: Props) {
  const navigate = useNavigate();
  const [autopilot, setAutopilot] = useState<AutopilotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticking, setTicking] = useState(false);
  const [pausing, setPausing] = useState(false);
  const abortRef = useRef(false);
  const mountedRef = useRef(true);

  // Phase 0: Voice state
  const [voiceStatus, setVoiceStatus] = useState<'checking' | 'set' | 'auto-selected' | 'none'>('checking');
  const [voiceLabel, setVoiceLabel] = useState<string | null>(null);

  // Phase 2: Auto-Run state — prefer external job from shared hook for consistency
  const [localAutoRunJob, setLocalAutoRunJob] = useState<any>(null);
  const autoRunJob = externalAutoRunJob ?? localAutoRunJob;
  const setAutoRunJob = setLocalAutoRunJob;
  const [autoRunLoading, setAutoRunLoading] = useState(false);
  // statusCheckedRef: true once the initial auto-run status fetch completes (prevents handoff race)
  const statusCheckedRef = useRef(false);
  // handoffInFlight prevents concurrent handoff calls within a single mount cycle
  const handoffInFlightRef = useRef(false);

  // Full Autopilot mode — auto-approve all gates + decisions
  // Default OFF — only enabled when a running job has allow_defaults=true, or user explicitly toggles
  const [fullAutopilot, setFullAutopilot] = useState(false);
  const autoApprovedGateRef = useRef<string | null>(null);
  const runNextInFlightRef = useRef(false);
  const lastRunNextKickRef = useRef(0);

  // Next Actions state
  const [hasComparables, setHasComparables] = useState<boolean | null>(null);
  const [findingComps, setFindingComps] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; abortRef.current = true; };
  }, []);

  // ═══ PHASE 0: Ensure writing voice ═══
  useEffect(() => {
    if (!projectId || !lane) { setVoiceStatus('none'); return; }

    const ensureVoice = async () => {
      try {
        const prefs = await loadProjectLaneRulesetPrefs(projectId, lane);
        if (prefs.writing_voice?.id) {
          setVoiceLabel(prefs.writing_voice.label || prefs.writing_voice.id);
          setVoiceStatus('set');
          return;
        }
        if (prefs.team_voice?.id) {
          setVoiceLabel(`Team: ${prefs.team_voice.label || prefs.team_voice.id}`);
          setVoiceStatus('set');
          return;
        }

        // Auto-select deterministic default
        const defaultVoice = getDefaultVoiceForLane(lane);
        if (defaultVoice) {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) { setVoiceStatus('none'); return; }

          const merged = { ...prefs, writing_voice: defaultVoice as any };
          await saveProjectLaneRulesetPrefs(projectId, lane, merged, user.id);
          setVoiceLabel(defaultVoice.label);
          setVoiceStatus('auto-selected');
        } else {
          setVoiceStatus('none');
        }
      } catch {
        setVoiceStatus('none');
      }
    };

    ensureVoice();
  }, [projectId, lane]);

  // ═══ PHASE 1: DevSeed status ═══
  const fetchStatus = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: { action: 'status', projectId },
      });
      if (error) {
        if (error.message?.includes('404') || error.message?.includes('not found') || error.message?.includes('Failed to fetch')) {
          // Function not deployed — silent
        }
        return;
      }
      if (mountedRef.current && data?.autopilot) {
        setAutopilot(data.autopilot);
      }
    } catch {
      // silent
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // ═══ PHASE 2: Auto-Run status polling ═══
  // When externalAutoRunJob is provided (from shared hook), skip independent fetching
  // to prevent Clean/Advanced state desync.
  const hasExternalJob = externalAutoRunJob !== undefined;

  const fetchAutoRunStatus = useCallback(async () => {
    if (hasExternalJob) { statusCheckedRef.current = true; return; }
    try {
      const result = await callAutoRun('status', { projectId });
      if (mountedRef.current && result?.job) {
        setAutoRunJob(result.job);
      }
    } catch {
      // no job yet — normal
    } finally {
      statusCheckedRef.current = true;
    }
  }, [projectId, hasExternalJob]);

  useEffect(() => { fetchAutoRunStatus(); }, [fetchAutoRunStatus]);

  // Poll auto-run status while running or awaiting approval (only when no external source)
  useEffect(() => {
    if (hasExternalJob) return;
    if (!autoRunJob) return;
    const shouldPoll = ['queued', 'running'].includes(autoRunJob.status) || autoRunJob.awaiting_approval;
    if (!shouldPoll) return;
    const interval = setInterval(fetchAutoRunStatus, 5000);
    return () => clearInterval(interval);
  }, [hasExternalJob, autoRunJob?.status, autoRunJob?.awaiting_approval, fetchAutoRunStatus]);

  // Keep the ladder advancing from this panel (recover from stale processing locks)
  // Only kick when we own the job source (no external provider)
  useEffect(() => {
    if (hasExternalJob) return;
    if (!autoRunJob?.id) return;
    if (!['queued', 'running'].includes(autoRunJob.status)) return;
    if (autoRunJob.awaiting_approval) return;

    const toMs = (value?: string | null) => {
      if (!value) return 0;
      const ts = new Date(value).getTime();
      return Number.isFinite(ts) ? ts : 0;
    };

    const lastSignalAt = Math.max(
      toMs(autoRunJob.last_heartbeat_at),
      toMs(autoRunJob.last_step_at),
      toMs(autoRunJob.updated_at),
    );

    const staleMs = Date.now() - lastSignalAt;
    const shouldKick = !autoRunJob.is_processing || staleMs > 30000;
    if (!shouldKick) return;
    if (runNextInFlightRef.current) return;
    if (Date.now() - lastRunNextKickRef.current < 3500) return;

    const timer = setTimeout(async () => {
      if (runNextInFlightRef.current) return;
      runNextInFlightRef.current = true;
      lastRunNextKickRef.current = Date.now();
      try {
        const tickResult = await callAutoRun('run-next', { jobId: autoRunJob.id });
        if (mountedRef.current && tickResult?.job) setAutoRunJob(tickResult.job);
      } catch {
        void fetchAutoRunStatus();
      } finally {
        runNextInFlightRef.current = false;
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [
    autoRunJob?.id,
    autoRunJob?.status,
    autoRunJob?.awaiting_approval,
    autoRunJob?.is_processing,
    autoRunJob?.last_heartbeat_at,
    autoRunJob?.last_step_at,
    autoRunJob?.updated_at,
    fetchAutoRunStatus,
  ]);

  // ═══ Check comparables ═══
  useEffect(() => {
    if (!projectId) return;
    (async () => {
      try {
        const { data } = await (supabase as any)
          .from('comparable_candidates')
          .select('id')
          .eq('project_id', projectId)
          .limit(1);
        if (mountedRef.current) setHasComparables(data && data.length > 0);
      } catch {
        if (mountedRef.current) setHasComparables(false);
      }
    })();
  }, [projectId]);

  // ═══ DevSeed tick loop ═══
  const runTicks = useCallback(async () => {
    if (abortRef.current) return;
    setTicking(true);
    try {
      let iterations = 0;
      const MAX = 20;
      while (iterations < MAX && !abortRef.current) {
        iterations++;
        const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
          body: { action: 'tick', projectId },
        });
        if (error) { console.error('[autopilot tick]', error.message); break; }
        const result = data as any;
        if (result?.autopilot && mountedRef.current) setAutopilot(result.autopilot);
        if (result?.done || result?.message === 'not_running') break;
        await new Promise(r => setTimeout(r, 1000));
      }
    } finally {
      if (mountedRef.current) setTicking(false);
    }
  }, [projectId]);

  // ═══ PHASE 1→2 HANDOFF: DB-driven (survives refresh) ═══
  // Triggers when: devseed complete AND no auto-run job exists yet
  // Guard: handoffInFlightRef prevents concurrent calls within same mount
  useEffect(() => {
    if (autopilot?.status !== 'complete') return;
    // CRITICAL: Wait until initial status check has completed to avoid race
    if (!statusCheckedRef.current) return;
    // If a job already exists in any non-terminal state, skip handoff
    if (autoRunJob && !['failed', 'stopped'].includes(autoRunJob.status)) return;
    // Also skip if we already have a completed job
    if (autoRunJob?.status === 'completed') return;
    // In-flight guard for this mount cycle
    if (handoffInFlightRef.current) return;
    handoffInFlightRef.current = true;

    const doHandoff = async () => {
      // Double-check via fresh DB status to prevent duplicate starts
      try {
        const freshStatus = await callAutoRun('status', { projectId });
        if (freshStatus?.job && !['failed', 'stopped'].includes(freshStatus.job.status)) {
          if (mountedRef.current) setAutoRunJob(freshStatus.job);
          handoffInFlightRef.current = false;
          return;
        }
      } catch {
        // No existing job — proceed to start
      }

      // Canon baseline population (non-blocking, best-effort, idempotent)
      populateCanonBaseline(projectId).catch(() => {});

      // Start Auto-Run with explicit allow_defaults for unblocked progression
      setAutoRunLoading(true);
      try {
        const result = await callAutoRun('start', {
          projectId,
          allow_defaults: true,
        });
        const existingJobId = result?.job_id || result?.existing_job_id;
        if (result?._resumable && existingJobId) {
          console.info('[ProjectAutopilot] Reattaching to existing Auto-Run job', existingJobId);
          await attachToExistingJob(existingJobId, mountedRef, projectId, setAutoRunJob);
        } else if (result?.job) {
          if (mountedRef.current) {
            setAutoRunJob(result.job);
          }
          // Fire non-blocking tick to begin advancing
          callAutoRun('run-next', { jobId: result.job.id }).then(tickResult => {
            if (mountedRef.current && tickResult?.job) setAutoRunJob(tickResult.job);
          }).catch(() => {});
        }
      } catch (err: any) {
        // Job may already exist — try fetching status as final fallback
        try {
          const status = await callAutoRun('status', { projectId });
          if (mountedRef.current && status?.job) {
            console.info('[ProjectAutopilot] Recovered via status fallback after start error');
            setAutoRunJob(status.job);
          } else {
            console.error('[ProjectAutopilot] Auto-Run start failed:', err?.message);
          }
        } catch {
          console.error('[ProjectAutopilot] Auto-Run start failed (no fallback):', err?.message);
        }
      } finally {
        if (mountedRef.current) setAutoRunLoading(false);
        handoffInFlightRef.current = false;
      }
    };

    doHandoff();
  }, [autopilot?.status, autoRunJob, projectId]);

  // ═══ Start / Resume / Pause (DevSeed) ═══
  const handleStart = useCallback(async () => {
    abortRef.current = false;
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: {
          action: 'start',
          projectId,
          pitchIdeaId: pitchIdeaId || undefined,
          options: {
            apply_seed_intel_pack: true,
            regen_foundation: true,
          },
        },
      });
      if (error) {
        if (error.message?.includes('Failed to fetch')) {
          toast.error('Autopilot function unavailable — please deploy edge function devseed-autopilot');
        } else {
          toast.error('Failed to start autopilot: ' + error.message);
        }
        return;
      }
      if (data?.autopilot && mountedRef.current) setAutopilot(data.autopilot);
      runTicks();
    } catch (err: any) {
      toast.error('Failed to start autopilot');
    }
  }, [projectId, pitchIdeaId, runTicks]);

  const handleResume = useCallback(async () => {
    abortRef.current = false;
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: { action: 'start', projectId, pitchIdeaId: pitchIdeaId || undefined },
      });
      if (error) { toast.error('Failed to resume: ' + error.message); return; }
      if (data?.autopilot && mountedRef.current) setAutopilot(data.autopilot);
      runTicks();
    } catch {
      toast.error('Failed to resume autopilot');
    }
  }, [projectId, pitchIdeaId, runTicks]);

  const handlePause = useCallback(async () => {
    setPausing(true);
    abortRef.current = true;
    try {
      const { data, error } = await supabase.functions.invoke('devseed-autopilot', {
        body: { action: 'pause', projectId },
      });
      if (error) { toast.error('Failed to pause: ' + error.message); return; }
      if (data?.autopilot && mountedRef.current) setAutopilot(data.autopilot);
    } catch {
      toast.error('Failed to pause autopilot');
    } finally {
      if (mountedRef.current) setPausing(false);
    }
  }, [projectId]);

  // ═══ Auto-Run resume handler (for blocked states) ═══
  const handleAutoRunResume = useCallback(async () => {
    if (!autoRunJob?.id) return;
    try {
      const result = await callAutoRun('resume', { jobId: autoRunJob.id, followLatest: true });
      if (mountedRef.current && result?.job) setAutoRunJob(result.job);
      // Fire non-blocking tick
      callAutoRun('run-next', { jobId: autoRunJob.id }).then(tickResult => {
        if (mountedRef.current && tickResult?.job) setAutoRunJob(tickResult.job);
      }).catch(() => {});
    } catch (err: any) {
      toast.error('Failed to resume auto-run: ' + (err?.message || 'Unknown error'));
    }
  }, [autoRunJob?.id]);

  // ═══ Full Autopilot: auto-approve all gates when enabled ═══
  const handleToggleFullAutopilot = useCallback(async (enabled: boolean) => {
    setFullAutopilot(enabled);
    if (!autoRunJob?.id) return;
    try {
      await (supabase as any).from('auto_run_jobs').update({ allow_defaults: enabled }).eq('id', autoRunJob.id);
      if (enabled) {
        toast.success('Full Autopilot enabled — all decisions will be auto-approved');
      } else {
        toast('Full Autopilot disabled — decisions will require manual approval');
      }
    } catch { /* non-fatal */ }
  }, [autoRunJob?.id]);

  // Keep local toggle synced with persisted job setting (refresh-safe)
  useEffect(() => {
    if (!autoRunJob) return;
    if (typeof autoRunJob.allow_defaults === 'boolean') {
      setFullAutopilot(autoRunJob.allow_defaults);
    }
  }, [autoRunJob?.id, autoRunJob?.allow_defaults]);

  // Auto-approve gates when Full Autopilot is ON
  useEffect(() => {
    if (!fullAutopilot || !autoRunJob) { autoApprovedGateRef.current = null; return; }
    if (!autoRunJob.awaiting_approval) { autoApprovedGateRef.current = null; return; }

    const gateKey = [autoRunJob.id, autoRunJob.approval_type, autoRunJob.pending_version_id || autoRunJob.pending_doc_id || 'none', autoRunJob.updated_at].join(':');
    if (autoApprovedGateRef.current === gateKey) return;
    autoApprovedGateRef.current = gateKey;

    (async () => {
      try {
        if (autoRunJob.approval_type === 'seed_core_officialize') {
          await callAutoRun('approve-seed-core', { jobId: autoRunJob.id, projectId });
        } else {
          await callAutoRun('approve-next', { jobId: autoRunJob.id, decision: 'approve' });
        }
        const tickResult = await callAutoRun('run-next', { jobId: autoRunJob.id });
        if (mountedRef.current && tickResult?.job) setAutoRunJob(tickResult.job);
      } catch {
        try {
          const result = await callAutoRun('resume', { jobId: autoRunJob.id, followLatest: true });
          if (mountedRef.current && result?.job) setAutoRunJob(result.job);
        } catch { /* non-fatal */ }
      }
    })();
  }, [
    fullAutopilot,
    autoRunJob?.id,
    autoRunJob?.awaiting_approval,
    autoRunJob?.approval_type,
    autoRunJob?.pending_version_id,
    autoRunJob?.pending_doc_id,
    autoRunJob?.updated_at,
    projectId,
  ]);

  // Auto-resume from decision pauses when Full Autopilot is ON
  useEffect(() => {
    if (!fullAutopilot || !autoRunJob) return;
    if (autoRunJob.status !== 'paused') return;
    if (autoRunJob.awaiting_approval) return;
    const hasPendingDecisions = Array.isArray(autoRunJob.pending_decisions) && autoRunJob.pending_decisions.length > 0;
    if (!hasPendingDecisions) return;

    (async () => {
      try {
        const result = await callAutoRun('resume', { jobId: autoRunJob.id, followLatest: true });
        if (mountedRef.current && result?.job) setAutoRunJob(result.job);
        const tickResult = await callAutoRun('run-next', { jobId: autoRunJob.id });
        if (mountedRef.current && tickResult?.job) setAutoRunJob(tickResult.job);
      } catch { /* non-fatal */ }
    })();
  }, [fullAutopilot, autoRunJob?.id, autoRunJob?.status, autoRunJob?.pending_decisions]);

  // PATCH B2: Bounded auto-recovery from DEV_ENGINE_UNAVAILABLE (max 3, backoff 5/15/30s)
  // Episode key is stable: only reset when jobId, status, or stop_reason changes — NOT on updated_at.
  const devEngineRecoverRef = useRef<{ jobId: string; stopReason: string; episodeTs: number; attempt: number; exhausted: boolean } | null>(null);
  const devEngineRecoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [devEngineRecoverExhausted, setDevEngineRecoverExhausted] = useState(false);

  useEffect(() => {
    if (!fullAutopilot || !autoRunJob) return;
    const isPausedDEU = autoRunJob.status === 'paused' && autoRunJob.stop_reason === 'DEV_ENGINE_UNAVAILABLE';

    // Reset if job is no longer in the paused+DEU state
    if (!isPausedDEU) {
      if (devEngineRecoverRef.current) {
        devEngineRecoverRef.current = null;
        setDevEngineRecoverExhausted(false);
      }
      if (devEngineRecoverTimerRef.current) { clearTimeout(devEngineRecoverTimerRef.current); devEngineRecoverTimerRef.current = null; }
      return;
    }

    // Reset if jobId changed (new job)
    const prev = devEngineRecoverRef.current;
    if (prev && prev.jobId !== autoRunJob.id) {
      devEngineRecoverRef.current = null;
      setDevEngineRecoverExhausted(false);
      if (devEngineRecoverTimerRef.current) { clearTimeout(devEngineRecoverTimerRef.current); devEngineRecoverTimerRef.current = null; }
    }

    // If already tracking this episode (same jobId + same stop_reason), do nothing — timer is running or exhausted
    if (devEngineRecoverRef.current && devEngineRecoverRef.current.jobId === autoRunJob.id) {
      return;
    }

    const BACKOFF_SCHEDULE = [5000, 15000, 30000];
    const MAX_ATTEMPTS = BACKOFF_SCHEDULE.length;

    // New episode — start bounded recovery
    const state = { jobId: autoRunJob.id, stopReason: 'DEV_ENGINE_UNAVAILABLE', episodeTs: Date.now(), attempt: 0, exhausted: false };
    devEngineRecoverRef.current = state;
    setDevEngineRecoverExhausted(false);

    const attemptRecover = async (attemptIndex: number) => {
      if (!mountedRef.current) return;
      const cur = devEngineRecoverRef.current;
      if (!cur || cur.jobId !== state.jobId || cur.episodeTs !== state.episodeTs) return;
      if (cur.exhausted) return;

      console.log(`[AutopilotPanel] AUTO_RECOVER_DEV_ENGINE_UNAVAILABLE attempt=${attemptIndex + 1}/${MAX_ATTEMPTS}`, { jobId: state.jobId });
      try {
        const result = await callAutoRun('resume', { jobId: state.jobId, followLatest: true });
        if (mountedRef.current && result?.job) setAutoRunJob(result.job);
        const tickResult = await callAutoRun('run-next', { jobId: state.jobId });
        if (mountedRef.current && tickResult?.job) {
          setAutoRunJob(tickResult.job);
          return; // success — ref resets on next effect when status changes
        }
      } catch (err: any) {
        console.warn(`[AutopilotPanel] AUTO_RECOVER_DEV_ENGINE_UNAVAILABLE attempt=${attemptIndex + 1} failed:`, err?.message);
      }

      const nextAttempt = attemptIndex + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        if (devEngineRecoverRef.current) devEngineRecoverRef.current.exhausted = true;
        setDevEngineRecoverExhausted(true);
        console.warn('[AutopilotPanel] AUTO_RECOVER_DEV_ENGINE_UNAVAILABLE exhausted after 3 attempts');
        return;
      }
      devEngineRecoverRef.current = { ...state, attempt: nextAttempt };
      devEngineRecoverTimerRef.current = setTimeout(() => attemptRecover(nextAttempt), BACKOFF_SCHEDULE[nextAttempt]);
    };

    devEngineRecoverTimerRef.current = setTimeout(() => attemptRecover(0), BACKOFF_SCHEDULE[0]);

    return () => { if (devEngineRecoverTimerRef.current) { clearTimeout(devEngineRecoverTimerRef.current); devEngineRecoverTimerRef.current = null; } };
  // Intentionally exclude updated_at — episode stability requires only jobId + status + stop_reason
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullAutopilot, autoRunJob?.id, autoRunJob?.status, autoRunJob?.stop_reason]);

  // ═══ Find Comparables CTA ═══
  const handleFindComparables = useCallback(async () => {
    if (!lane) return;
    setFindingComps(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.functions.invoke('comps-engine', {
        body: {
          action: 'find_candidates',
          project_id: projectId,
          lane,
          user_id: user.id,
          use_project_docs: true,
          filters: {},
        },
      });
      if (error) throw error;
      toast.success('Comparables search started');
      setHasComparables(true);
    } catch (err: any) {
      toast.error('Failed to find comparables: ' + (err?.message || 'Unknown error'));
    } finally {
      setFindingComps(false);
    }
  }, [projectId, lane]);

  if (loading) return null;

  const status = autopilot?.status;
  const isRunning = status === 'running' || ticking;
  const hasError = status === 'error' || (autopilot && Object.values(autopilot.stages || {}).some(s => s.status === 'error'));
  const isPaused = status === 'paused';
  const isSeedComplete = status === 'complete';
  const canStart = !autopilot || status === 'idle';
  const canResume = (hasError || isPaused) && !ticking;

  // Phase 2 derived state — blocked/paused override running
  const autoRunStatus = autoRunJob?.status;
  const autoRunBlocked = autoRunJob?.awaiting_approval === true;
  const autoRunPaused = autoRunStatus === 'paused';
  const autoRunComplete = autoRunStatus === 'completed';
  const autoRunFailed = autoRunStatus === 'failed' || autoRunStatus === 'stopped';
  // "Running" only when truly running and NOT blocked/paused
  const autoRunRunning = (autoRunStatus === 'running' || autoRunStatus === 'queued') && !autoRunBlocked && !autoRunPaused;
  const autoRunStopReason = autoRunJob?.stop_reason;
  const autoRunApprovalType = autoRunJob?.approval_type;
  const autoRunUiMessage = autoRunJob?.last_ui_message;

  // Phase status helpers
  const getPhase0Status = () => {
    if (voiceStatus === 'checking') return 'checking';
    if (voiceStatus === 'set' || voiceStatus === 'auto-selected') return 'done';
    return 'warning';
  };

  const getPhase1Status = () => {
    if (isSeedComplete) return 'done';
    if (isRunning) return 'running';
    if (hasError) return 'error';
    if (isPaused) return 'paused';
    return 'pending';
  };

  const getPhase2Status = () => {
    if (!isSeedComplete) return 'pending';
    if (autoRunLoading) return 'starting';
    if (autoRunComplete) return 'done';
    if (autoRunBlocked || autoRunPaused) return 'blocked';
    if (autoRunRunning) return 'running';
    if (autoRunFailed) return 'error';
    return 'pending';
  };

  const PhaseIcon = ({ status: s }: { status: string }) => {
    switch (s) {
      case 'done': return <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />;
      case 'running':
      case 'starting':
      case 'checking': return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
      case 'error': return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
      case 'warning':
      case 'blocked': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
      case 'paused': return <Pause className="h-3.5 w-3.5 text-muted-foreground" />;
      default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  // Build Mission Control URL
  const missionControlUrl = `/projects/${projectId}/development?tab=autorun#autorun-mission-control`;

  // Describe the blocking reason for the user
  const getBlockingDescription = () => {
    if (autoRunApprovalType === 'input_incomplete') {
      return autoRunUiMessage || 'Some required documents are missing content. Add content and resume.';
    }
    if (autoRunApprovalType === 'seed_core_officialize') {
      return 'Seed documents need to be approved before proceeding.';
    }
    if (autoRunStopReason?.startsWith('Approval required')) {
      return autoRunStopReason;
    }
    if (autoRunUiMessage) return autoRunUiMessage;
    if (autoRunStopReason) return autoRunStopReason;
    return 'Auto-Run is paused and needs your input to continue.';
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Project Autopilot</CardTitle>
          {autoRunComplete && isSeedComplete && <Badge variant="default" className="text-[10px] h-5">Complete</Badge>}
          {(isRunning || autoRunRunning) && !autoRunBlocked && <Badge variant="secondary" className="text-[10px] h-5">Running</Badge>}
          {(autoRunBlocked || autoRunPaused) && <Badge variant="outline" className="text-[10px] h-5 border-amber-500/50 text-amber-600">Blocked</Badge>}
          {hasError && !isRunning && !autoRunBlocked && <Badge variant="destructive" className="text-[10px] h-5">Error</Badge>}
          {isPaused && !hasError && <Badge variant="secondary" className="text-[10px] h-5">Paused</Badge>}
        </div>
        <div className="flex gap-2">
          {canStart && (
            <Button size="sm" onClick={handleStart} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Start Autopilot
            </Button>
          )}
          {canResume && (
            <Button size="sm" variant="outline" onClick={handleResume} className="h-7 text-xs gap-1">
              <Play className="h-3 w-3" /> Resume
            </Button>
          )}
          {isRunning && (
            <Button size="sm" variant="outline" onClick={handlePause} disabled={pausing} className="h-7 text-xs gap-1">
              {pausing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
              Pause
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-3 pt-0 space-y-3">
        {/* ═══ Full Autopilot Toggle ═══ */}
        {autoRunJob && !autoRunComplete && (
          <div className="flex items-center justify-between px-2 py-1.5 rounded border border-border/30 bg-muted/20">
            <div className="flex items-center gap-2">
              <Zap className={`h-3.5 w-3.5 ${fullAutopilot ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="text-[10px] font-medium text-foreground">Full Autopilot</span>
              <span className="text-[9px] text-muted-foreground">— auto-approve all decisions & gates</span>
            </div>
            <Switch
              checked={fullAutopilot}
              onCheckedChange={handleToggleFullAutopilot}
              className="scale-75"
            />
          </div>
        )}
        {/* ═══ PHASE 0: Voice ═══ */}
        <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 border border-border/30">
          <PhaseIcon status={getPhase0Status()} />
          <span className="text-xs font-medium text-foreground flex-1">
            Phase 0: Writing Voice
          </span>
          {voiceStatus === 'set' && (
            <Badge variant="secondary" className="text-[10px] h-5">
              <Mic className="h-2.5 w-2.5 mr-1" />
              {voiceLabel}
            </Badge>
          )}
          {voiceStatus === 'auto-selected' && (
            <Badge variant="outline" className="text-[10px] h-5 border-amber-500/30 text-amber-600">
              <Mic className="h-2.5 w-2.5 mr-1" />
              Auto: {voiceLabel}
            </Badge>
          )}
          {voiceStatus === 'none' && (
            <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">
              No voice (system default)
            </Badge>
          )}
        </div>

        {/* ═══ PHASE 1: Seed (DevSeed) ═══ */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 border border-border/30">
            <PhaseIcon status={getPhase1Status()} />
            <span className="text-xs font-medium text-foreground flex-1">
              Phase 1: Seed (DevSeed)
            </span>
            {isSeedComplete && <Badge variant="default" className="text-[10px] h-5">Done</Badge>}
            {isRunning && <Badge variant="secondary" className="text-[10px] h-5">Running</Badge>}
            {hasError && !isRunning && <Badge variant="destructive" className="text-[10px] h-5">Error</Badge>}
          </div>
          {autopilot && (
            <AutopilotProgress
              autopilot={autopilot}
              onResume={canResume ? handleResume : undefined}
              isResuming={ticking}
            />
          )}
        </div>

        {/* ═══ PHASE 2: Develop (Auto-Run Ladder) ═══ */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 border border-border/30">
            <PhaseIcon status={getPhase2Status()} />
            <span className="text-xs font-medium text-foreground flex-1">
              Phase 2: Develop (Auto-Run)
            </span>
            {autoRunComplete && <Badge variant="default" className="text-[10px] h-5">Done</Badge>}
            {autoRunRunning && !autoRunBlocked && <Badge variant="secondary" className="text-[10px] h-5">Running</Badge>}
            {autoRunFailed && <Badge variant="destructive" className="text-[10px] h-5">Failed</Badge>}
            {autoRunLoading && <Badge variant="secondary" className="text-[10px] h-5">Starting…</Badge>}
            {(autoRunBlocked || autoRunPaused) && <Badge variant="outline" className="text-[10px] h-5 border-amber-500/50 text-amber-600">Needs Input</Badge>}
          </div>

          {/* ═══ BLOCKING DECISION UI ═══ */}
          {autoRunJob && (autoRunBlocked || autoRunPaused) && (() => {
            // Resolve blocking doc type
            const blockingDocType = autoRunJob.approval_required_for_doc_type
              || autoRunJob.pending_doc_type
              || autoRunJob.current_document;
            // Resolve docId from doc_type via passed documents
            const docIdByType = new Map((documents || []).map((d: { id: string; doc_type: string }) => [d.doc_type, d.id]));
            const blockingDocId = blockingDocType ? docIdByType.get(blockingDocType) : undefined;
            // Compute unapproved doc types (only when awaiting approval)
            const unapprovedDocTypes = (autoRunBlocked && documents && approvedVersionMap)
              ? documents
                  .filter((d: { id: string; doc_type: string }) => !(approvedVersionMap as any)[d.id])
                  .map((d: { id: string; doc_type: string }) => d.doc_type)
                  .slice(0, 8) // cap to avoid overwhelming
              : [];

            return (
              <div className="px-3 py-2.5 text-xs space-y-2 border border-amber-500/30 rounded bg-amber-500/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-1 flex-1">
                    <p className="font-medium text-foreground">Blocking Decision</p>
                    <p className="text-muted-foreground">{getBlockingDescription()}</p>
                    {/* Show specific doc/stage details */}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {autoRunJob.current_document && (
                        <Badge variant="outline" className="text-[9px] h-4">
                          Stage: {autoRunJob.current_document.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      {autoRunJob.approval_required_for_doc_type && (
                        <Badge variant="outline" className="text-[9px] h-4 border-amber-500/40 text-amber-600">
                          Needs: {autoRunJob.approval_required_for_doc_type.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      {autoRunJob.pending_doc_type && autoRunJob.pending_doc_type !== autoRunJob.approval_required_for_doc_type && (
                        <Badge variant="outline" className="text-[9px] h-4">
                          Pending: {autoRunJob.pending_doc_type.replace(/_/g, ' ')}
                        </Badge>
                      )}
                    </div>
                    {/* Unapproved docs list */}
                    {unapprovedDocTypes.length > 0 && (
                      <div className="mt-1.5 space-y-0.5">
                        <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Unapproved documents</p>
                        <div className="flex flex-wrap gap-1">
                          {unapprovedDocTypes.map((dt: string) => (
                            <Badge
                              key={dt}
                              variant="outline"
                              className={`text-[9px] h-4 cursor-pointer hover:bg-muted/50 ${dt === blockingDocType ? 'border-amber-500/40 text-amber-600' : ''}`}
                              onClick={() => {
                                const docId = docIdByType.get(dt);
                                if (docId && onSelectDocument) onSelectDocument(docId);
                              }}
                            >
                              {dt.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blockingDocId && onSelectDocument && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onSelectDocument(blockingDocId)}
                      className="h-6 text-[10px] gap-1"
                    >
                      <FileText className="h-3 w-3" />
                      Open Required Doc
                    </Button>
                  )}
                  {/* PATCH C2: Show "Recovering…" or exhausted state for transient error */}
                  {fullAutopilot && autoRunStopReason === 'DEV_ENGINE_UNAVAILABLE' && !devEngineRecoverExhausted ? (
                    <Badge variant="outline" className="text-[10px] h-6 gap-1 border-primary/40 text-primary">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Recovering…
                    </Badge>
                  ) : fullAutopilot && autoRunStopReason === 'DEV_ENGINE_UNAVAILABLE' && devEngineRecoverExhausted ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={handleAutoRunResume}
                      className="h-6 text-[10px] gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      Recovery failed — Resume
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleAutoRunResume}
                      className="h-6 text-[10px] gap-1"
                    >
                      <ArrowRight className="h-3 w-3" />
                      Resume Auto-Run
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => navigate(missionControlUrl)}>
                    <ExternalLink className="h-3 w-3" />
                    Open Mission Control
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Auto-Run details when available and not blocked */}
          {autoRunJob && !autoRunBlocked && !autoRunPaused && (
            <div className="px-3 py-2 text-xs space-y-1 border border-border/20 rounded">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Current stage:</span>
                <span className="font-medium">{autoRunJob.current_document?.replace(/_/g, ' ') || '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Steps:</span>
                <span className="font-medium">{autoRunJob.step_count || 0} / {autoRunJob.max_total_steps || '—'}</span>
              </div>
              {autoRunJob.last_ci != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">CI / GP:</span>
                  <span className="font-medium">{autoRunJob.last_ci} / {autoRunJob.last_gp ?? '—'}</span>
                </div>
              )}
              {autoRunJob.stop_reason && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Stop reason:</span>
                  <span className="font-medium text-destructive">{autoRunJob.stop_reason}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate(missionControlUrl)}
                className="flex items-center gap-1 text-primary hover:underline text-[11px] mt-1"
              >
                <ExternalLink className="h-3 w-3" />
                Open Mission Control
              </button>
            </div>
          )}

          {!isSeedComplete && !autoRunJob && (
            <p className="text-[10px] text-muted-foreground px-2">
              Auto-Run will start automatically after DevSeed completes.
            </p>
          )}
        </div>

        {/* ═══ NEXT ACTIONS ═══ */}
        {(isSeedComplete || autoRunJob) && (
          <div className="space-y-1 pt-1 border-t border-border/30">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Next Actions</span>
            <div className="space-y-1">
              {hasComparables === false && (
                <div className="flex items-center justify-between px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/20">
                  <span className="text-xs text-foreground">Find comparables to build engine profile</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleFindComparables}
                    disabled={findingComps || !lane}
                    className="h-6 text-[10px] gap-1"
                  >
                    {findingComps ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                    Find Comparables
                  </Button>
                </div>
              )}
              {hasComparables === true && (
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                  <CheckCircle className="h-3 w-3 text-emerald-500" />
                  <span>Comparables found — build engine profile from World Rules panel below</span>
                </div>
              )}
              {hasComparables === null && (
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Checking comparables…
                </div>
              )}
            </div>
          </div>
        )}

        {/* No autopilot yet prompt */}
        {!autopilot && !autoRunJob && (
          <p className="text-xs text-muted-foreground">
            No autopilot run yet. Click "Start Autopilot" to begin automated project setup.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
