/**
 * AutopilotPanel — "Project Autopilot" orchestration panel.
 *
 * Phase 0: Ensure writing voice (deterministic default if missing)
 * Phase 1: DevSeed (apply_seed_intel_pack + regen_foundation)
 * Phase 2: Auto-Run ladder (start on DevSeed completion, show status)
 *
 * Backend edge functions are NOT renamed — this is a UI presentation change.
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AutopilotProgress, type AutopilotState } from '@/components/pitch/AutopilotProgress';
import { Loader2, Play, Pause, Rocket, AlertTriangle, Mic, Search, ExternalLink, CheckCircle, Clock } from 'lucide-react';
import { getDefaultVoiceForLane } from '@/lib/writingVoices/select';
import { loadProjectLaneRulesetPrefs, saveProjectLaneRulesetPrefs } from '@/lib/rulesets/uiState';

interface Props {
  projectId: string;
  pitchIdeaId?: string | null;
  lane?: string | null;
  format?: string | null;
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
  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Auto-run error');
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

export function AutopilotPanel({ projectId, pitchIdeaId, lane, format }: Props) {
  const [autopilot, setAutopilot] = useState<AutopilotState | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticking, setTicking] = useState(false);
  const [pausing, setPausing] = useState(false);
  const abortRef = useRef(false);
  const mountedRef = useRef(true);

  // Phase 0: Voice state
  const [voiceStatus, setVoiceStatus] = useState<'checking' | 'set' | 'auto-selected' | 'none'>('checking');
  const [voiceLabel, setVoiceLabel] = useState<string | null>(null);

  // Phase 2: Auto-Run state
  const [autoRunJob, setAutoRunJob] = useState<any>(null);
  const [autoRunLoading, setAutoRunLoading] = useState(false);
  const handoffStartedRef = useRef(false);
  const canonPopulatedRef = useRef(false);

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
  const fetchAutoRunStatus = useCallback(async () => {
    try {
      const result = await callAutoRun('status', { projectId });
      if (mountedRef.current && result?.job) {
        setAutoRunJob(result.job);
      }
    } catch {
      // no job yet — normal
    }
  }, [projectId]);

  useEffect(() => { fetchAutoRunStatus(); }, [fetchAutoRunStatus]);

  // Poll auto-run status while running
  useEffect(() => {
    if (!autoRunJob || !['queued', 'running'].includes(autoRunJob.status)) return;
    const interval = setInterval(fetchAutoRunStatus, 5000);
    return () => clearInterval(interval);
  }, [autoRunJob?.status, fetchAutoRunStatus]);

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

  // ═══ PHASE 1→2 HANDOFF: On DevSeed completion, start Auto-Run ═══
  useEffect(() => {
    if (autopilot?.status !== 'complete') return;
    if (handoffStartedRef.current) return;
    if (autoRunJob && ['queued', 'running', 'completed'].includes(autoRunJob.status)) return;

    handoffStartedRef.current = true;

    const doHandoff = async () => {
      // Canon baseline population (non-blocking, best-effort)
      if (!canonPopulatedRef.current) {
        canonPopulatedRef.current = true;
        populateCanonBaseline(projectId).catch(() => {});
      }

      // Start Auto-Run
      setAutoRunLoading(true);
      try {
        const result = await callAutoRun('start', { projectId });
        if (mountedRef.current) {
          setAutoRunJob(result.job);
        }
        // Fire non-blocking tick
        callAutoRun('run-next', { jobId: result.job.id }).then(tickResult => {
          if (mountedRef.current && tickResult?.job) setAutoRunJob(tickResult.job);
        }).catch(() => {});
      } catch (err: any) {
        // Job may already exist — try fetching status
        try {
          const status = await callAutoRun('status', { projectId });
          if (mountedRef.current && status?.job) setAutoRunJob(status.job);
        } catch {
          console.error('[ProjectAutopilot] Auto-Run start failed:', err?.message);
        }
      } finally {
        if (mountedRef.current) setAutoRunLoading(false);
      }
    };

    doHandoff();
  }, [autopilot?.status, autoRunJob, projectId]);

  // ═══ Start / Resume / Pause (DevSeed) ═══
  const handleStart = useCallback(async () => {
    abortRef.current = false;
    handoffStartedRef.current = false;
    canonPopulatedRef.current = false;
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

  // Phase 2 derived state
  const autoRunStatus = autoRunJob?.status;
  const autoRunRunning = autoRunStatus === 'running' || autoRunStatus === 'queued';
  const autoRunComplete = autoRunStatus === 'completed';
  const autoRunFailed = autoRunStatus === 'failed' || autoRunStatus === 'stopped';

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
      case 'warning': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
      case 'paused': return <Pause className="h-3.5 w-3.5 text-muted-foreground" />;
      default: return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  // Build Mission Control URL
  const missionControlUrl = `/projects/${projectId}/development?tab=autorun`;

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm">Project Autopilot</CardTitle>
          {autoRunComplete && isSeedComplete && <Badge variant="default" className="text-[10px] h-5">Complete</Badge>}
          {(isRunning || autoRunRunning) && <Badge variant="secondary" className="text-[10px] h-5">Running</Badge>}
          {hasError && !isRunning && <Badge variant="destructive" className="text-[10px] h-5">Error</Badge>}
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
            {autoRunRunning && <Badge variant="secondary" className="text-[10px] h-5">Running</Badge>}
            {autoRunFailed && <Badge variant="destructive" className="text-[10px] h-5">Failed</Badge>}
            {autoRunLoading && <Badge variant="secondary" className="text-[10px] h-5">Starting…</Badge>}
          </div>

          {/* Auto-Run details when available */}
          {autoRunJob && (
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
              <a
                href={missionControlUrl}
                className="flex items-center gap-1 text-primary hover:underline text-[11px] mt-1"
              >
                <ExternalLink className="h-3 w-3" />
                Open Mission Control
              </a>
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
                  Comparables found — build engine profile from World Rules panel
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
