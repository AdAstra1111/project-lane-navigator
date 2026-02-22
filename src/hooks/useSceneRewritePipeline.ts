import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';
import type { ActivityItem } from '@/components/devengine/ActivityTimeline';
import type { RewriteScopePlan, RewriteVerification, RewriteProvenance } from '@/types/rewrite-scope';

export interface SceneRewriteJob {
  scene_number: number;
  scene_heading?: string;
  status: string;
  attempts: number;
  error?: string | null;
  claimed_at?: string | null;
}

export interface SceneMetrics {
  duration_ms?: number;
  input_chars?: number;
  output_chars?: number;
  delta_pct?: number;
  skipped?: boolean;
}

export interface ProbeResult {
  has_scenes: boolean;
  scenes_count: number;
  rewrite_default_mode: 'scene' | 'chunk';
  script_chars: number;
}

export interface PreviewResult {
  preview_text: string;
  total_chars: number;
  scenes_count: number;
  missing_scenes: number[];
}

export interface SceneRewriteState {
  mode: 'idle' | 'probing' | 'enqueuing' | 'processing' | 'assembling' | 'complete' | 'error';
  hasScenes: boolean | null;
  scenesCount: number;
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  scenes: SceneRewriteJob[];
  error: string | null;
  newVersionId: string | null;
  rewriteMode: 'scene' | 'chunk' | null;
  probeResult: ProbeResult | null;
  selectedRewriteMode: 'auto' | 'scene' | 'chunk';
  lastProbedAt: string | null;
  sceneMetrics: Record<number, SceneMetrics>;
  oldestRunningClaimedAt: string | null;
  // Progress / ETA / smoothing
  etaMs: number | null;
  avgUnitMs: number | null;
  smoothedPercent: number;
  lastProgressAt: number;
  // Scope plan + verification
  scopePlan: RewriteScopePlan | null;
  verification: RewriteVerification | null;
  scopeExpandedFrom: number[] | null;
  expansionCount: number;
  // Selective rewrite tracking
  totalScenesInScript: number;
  targetSceneNumbers: number[];
  // Last assembled version metadata
  lastAssembledVersionLabel: string | null;
  lastAssembledChangeSummary: string | null;
  lastAssembledVersionNumber: number | null;
  lastAssembledSelective: boolean | null;
  lastAssembledTargetCount: number | null;
  // Run tracking
  runId: string | null;
}

const initialState: SceneRewriteState = {
  mode: 'idle',
  hasScenes: null,
  scenesCount: 0,
  total: 0, queued: 0, running: 0, done: 0, failed: 0,
  scenes: [],
  error: null,
  newVersionId: null,
  rewriteMode: null,
  probeResult: null,
  selectedRewriteMode: 'auto',
  lastProbedAt: null,
  sceneMetrics: {},
  oldestRunningClaimedAt: null,
  etaMs: null,
  avgUnitMs: null,
  smoothedPercent: 0,
  lastProgressAt: 0,
  scopePlan: null,
  verification: null,
  scopeExpandedFrom: null,
  expansionCount: 0,
  totalScenesInScript: 0,
  targetSceneNumbers: [],
  lastAssembledVersionLabel: null,
  lastAssembledChangeSummary: null,
  lastAssembledVersionNumber: null,
  lastAssembledSelective: null,
  lastAssembledTargetCount: null,
  runId: null,
};

async function callEngine(action: string, extra: Record<string, any> = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...extra }),
    signal: controller.signal,
  });
  clearTimeout(timeout);

  const text = await resp.text();
  if (!text || text.trim().length === 0) throw new Error('Empty response from engine');
  let result: any;
  try { result = JSON.parse(text); } catch {
    throw new Error('Invalid response from engine');
  }
  if (resp.status === 402) throw new Error('AI credits exhausted.');
  if (resp.status === 429) throw new Error('Rate limit reached. Try again in a moment.');
  if (!resp.ok) throw new Error(result.error || 'Engine error');
  return result;
}

// Rolling average helper
function rollingAvg(durations: number[], windowSize = 5): number {
  if (durations.length === 0) return 0;
  const window = durations.slice(-windowSize);
  return window.reduce((a, b) => a + b, 0) / window.length;
}

// ── sessionStorage helpers for runId persistence ──
function makeRunIdKey(projectId: string, sourceVersionId: string) {
  return `sceneRewriteRun:${projectId}:${sourceVersionId}`;
}
function saveRunId(projectId: string, sourceVersionId: string, runId: string) {
  try { sessionStorage.setItem(makeRunIdKey(projectId, sourceVersionId), runId); } catch {}
}
function loadRunId(projectId: string, sourceVersionId: string): string | null {
  try { return sessionStorage.getItem(makeRunIdKey(projectId, sourceVersionId)); } catch { return null; }
}
function clearRunId(projectId: string, sourceVersionId: string) {
  try { sessionStorage.removeItem(makeRunIdKey(projectId, sourceVersionId)); } catch {}
}

// ── DB fallback: fetch latest active run when local refs are empty ──
async function fetchLatestRunId(projectId: string, sourceVersionId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('rewrite_runs')
      .select('id')
      .eq('project_id', projectId)
      .eq('source_version_id', sourceVersionId)
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id || null;
  } catch {
    return null;
  }
}

export function useSceneRewritePipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<SceneRewriteState>(initialState);
  const processingRef = useRef(false);
  const stopRef = useRef(false);
  const startGuardRef = useRef(false);
  const durationsRef = useRef<number[]>([]);
  const runIdRef = useRef<string | null>(null);
  const lastSourceVersionIdRef = useRef<string | null>(null);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const smoothingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushActivity = useCallback((level: ActivityItem['level'], message: string) => {
    setActivityItems(prev => [{ ts: new Date().toISOString(), level, message }, ...prev].slice(0, 200));
  }, []);

  const clearActivity = useCallback(() => setActivityItems([]), []);

  const invalidate = useCallback(() => {
    invalidateDevEngine(qc, { projectId, deep: true });
  }, [qc, projectId]);

  const setSelectedRewriteMode = useCallback((mode: 'auto' | 'scene' | 'chunk') => {
    setState(s => ({ ...s, selectedRewriteMode: mode }));
  }, []);

  // Start smoothing interval
  const startSmoothing = useCallback(() => {
    if (smoothingTimerRef.current) return;
    smoothingTimerRef.current = setInterval(() => {
      setState(s => {
        if (s.mode !== 'processing' && s.mode !== 'enqueuing') return s;
        const elapsed = Date.now() - s.lastProgressAt;
        if (elapsed < 2500) return s;
        const actualPct = s.total > 0 ? (s.done / s.total) * 100 : 0;
        const maxSmoothed = Math.min(actualPct + 2, 99);
        if (s.smoothedPercent >= maxSmoothed) return s;
        return { ...s, smoothedPercent: Math.min(s.smoothedPercent + 0.3, maxSmoothed) };
      });
    }, 1000);
  }, []);

  const stopSmoothing = useCallback(() => {
    if (smoothingTimerRef.current) {
      clearInterval(smoothingTimerRef.current);
      smoothingTimerRef.current = null;
    }
  }, []);


  // Probe whether scenes exist
  const probe = useCallback(async (sourceDocId: string, sourceVersionId: string) => {
    if (!projectId) return null;
    setState(s => ({ ...s, mode: 'probing' }));
    try {
      const result = await callEngine('rewrite_debug_probe', { projectId, sourceDocId, sourceVersionId });
      const probeResult: ProbeResult = {
        has_scenes: result.has_scenes,
        scenes_count: result.scenes_count,
        rewrite_default_mode: result.rewrite_default_mode,
        script_chars: result.script_chars,
      };
      setState(s => ({
        ...s,
        mode: 'idle',
        hasScenes: result.has_scenes,
        scenesCount: result.scenes_count,
        rewriteMode: result.rewrite_default_mode,
        probeResult,
        lastProbedAt: new Date().toISOString(),
      }));
      pushActivity('info', `Probe: ${result.scenes_count} scenes detected (${result.script_chars.toLocaleString()} chars) → ${result.rewrite_default_mode}`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'idle' }));
      pushActivity('error', `Probe failed: ${err.message}`);
      return null;
    }
  }, [projectId, pushActivity]);

  // Load existing status (for resume after refresh)
  const loadStatus = useCallback(async (sourceVersionId: string) => {
    if (!projectId) return;
    lastSourceVersionIdRef.current = sourceVersionId;
    let currentRunId = runIdRef.current;
    if (!currentRunId) {
      // Attempt restore from sessionStorage
      currentRunId = loadRunId(projectId, sourceVersionId);
      if (currentRunId) {
        runIdRef.current = currentRunId;
        setState(s => ({ ...s, runId: currentRunId }));
      }
    }
    if (!currentRunId) {
      // DB fallback
      currentRunId = await fetchLatestRunId(projectId, sourceVersionId);
      if (currentRunId) {
        runIdRef.current = currentRunId;
        saveRunId(projectId, sourceVersionId, currentRunId);
        setState(s => ({ ...s, runId: currentRunId }));
      }
    }
    if (!currentRunId) {
      pushActivity('warn', 'No active rewrite run to resume');
      return;
    }
    try {
      const result = await callEngine('get_rewrite_status', { projectId, sourceVersionId, runId: currentRunId });
      if (result.total > 0) {
        const pct = result.total > 0 ? (result.done / result.total) * 100 : 0;
        setState(s => ({
          ...s,
          total: result.total,
          queued: result.queued,
          running: result.running,
          done: result.done,
          failed: result.failed,
          scenes: result.scenes || [],
          oldestRunningClaimedAt: result.oldest_running_claimed_at || null,
          mode: result.done === result.total ? 'complete'
            : (result.queued > 0 || result.running > 0) ? 'processing' : 'idle',
          smoothedPercent: pct,
          lastProgressAt: Date.now(),
        }));
        pushActivity('info', `Loaded status: ${result.done}/${result.total} done, ${result.queued} queued, ${result.failed} failed`);
      }
    } catch { /* non-critical */ }
  }, [projectId, pushActivity]);

  // Enqueue scene jobs (optionally selective)
  const enqueue = useCallback(async (
    sourceDocId: string,
    sourceVersionId: string,
    approvedNotes: any[],
    protectItems: string[],
    targetSceneNumbers?: number[],
  ) => {
    if (!projectId) return;
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    const isSelective = Array.isArray(targetSceneNumbers) && targetSceneNumbers.length > 0;
    setState(s => ({ ...s, mode: 'enqueuing', error: null, newVersionId: null }));
    pushActivity('info', isSelective
      ? `Enqueuing ${targetSceneNumbers!.length} target scene jobs…`
      : 'Enqueuing scene jobs…');
    try {
      lastSourceVersionIdRef.current = sourceVersionId;
      const result = await callEngine('enqueue_rewrite_jobs', {
        projectId, sourceDocId, sourceVersionId, approvedNotes, protectItems,
        targetSceneNumbers: targetSceneNumbers || undefined,
      });
      const newRunId = result.runId || null;
      runIdRef.current = newRunId;
      if (newRunId && projectId) {
        saveRunId(projectId, sourceVersionId, newRunId);
      }
      setState(s => ({
        ...s,
        mode: 'processing',
        total: result.totalScenes,
        queued: result.queued || result.totalScenes,
        done: 0,
        failed: 0,
        running: 0,
        rewriteMode: 'scene',
        smoothedPercent: 0,
        lastProgressAt: Date.now(),
        runId: newRunId,
      }));
      pushActivity('success', isSelective
        ? `Enqueued ${targetSceneNumbers!.length} target scene jobs (run ${(result.runId || '?').slice(0, 8)})`
        : `Enqueued ${result.totalScenes} scene jobs (run ${(result.runId || '?').slice(0, 8)})`
      );
      toast.success(isSelective
        ? `${targetSceneNumbers!.length} target scenes queued for rewrite`
        : `${result.totalScenes} scenes queued for rewrite`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      pushActivity('error', `Enqueue failed: ${err.message}`);
      toast.error(err.message);
      return null;
    } finally {
      startGuardRef.current = false;
    }
  }, [projectId, pushActivity]);

  // Process jobs one at a time in a loop, then auto-assemble
  const processAll = useCallback(async (sourceVersionId: string, sourceDocId?: string) => {
    if (!projectId || processingRef.current) return;
    lastSourceVersionIdRef.current = sourceVersionId;
    let currentRunId = runIdRef.current;
    if (!currentRunId) {
      // Attempt restore from sessionStorage
      currentRunId = loadRunId(projectId, sourceVersionId);
      if (currentRunId) {
        runIdRef.current = currentRunId;
        setState(s => ({ ...s, runId: currentRunId }));
      }
    }
    if (!currentRunId) {
      // DB fallback: fetch latest active run
      currentRunId = await fetchLatestRunId(projectId, sourceVersionId);
      if (currentRunId) {
        runIdRef.current = currentRunId;
        saveRunId(projectId, sourceVersionId, currentRunId);
        setState(s => ({ ...s, runId: currentRunId }));
        pushActivity('info', `Recovered runId from database: ${currentRunId.slice(0, 8)}`);
      }
    }
    if (!currentRunId) {
      toast.error('Missing runId — please enqueue again.');
      pushActivity('error', 'Missing runId — please enqueue again.');
      return;
    }
    processingRef.current = true;
    stopRef.current = false;
    durationsRef.current = [];
    setState(s => ({ ...s, mode: 'processing', lastProgressAt: Date.now() }));
    startSmoothing();
    pushActivity('info', `Processing started (run ${currentRunId.slice(0, 8)})`);

    let scenesProcessed = 0;

    try {
      let consecutiveEmpty = 0;
      while (!stopRef.current) {
        const result = await callEngine('process_next_rewrite_job', {
          projectId, sourceVersionId,
          runId: currentRunId,
        });

        if (stopRef.current) break;

        if (!result.processed) {
          // If backend says all done for this run, break immediately
          if (result.done) break;
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        consecutiveEmpty = 0;
        scenesProcessed++;

        // Track duration for ETA
        if (result.duration_ms && !result.skipped) {
          durationsRef.current.push(result.duration_ms);
        }

        // Store per-scene metrics
        if (result.scene_number) {
          const durationStr = result.duration_ms ? `${(result.duration_ms / 1000).toFixed(1)}s` : '';
          const deltaStr = result.delta_pct != null ? ` ${result.delta_pct > 0 ? '+' : ''}${result.delta_pct}%` : '';
          pushActivity(
            result.status === 'done' ? 'success' : 'error',
            result.skipped 
              ? `Scene ${result.scene_number} skipped (already done)` 
              : `Scene ${result.scene_number} ${result.status} (${durationStr}${deltaStr})`
          );

          setState(s => ({
            ...s,
            sceneMetrics: {
              ...s.sceneMetrics,
              [result.scene_number]: {
                duration_ms: result.duration_ms,
                input_chars: result.input_chars,
                output_chars: result.output_chars,
                delta_pct: result.delta_pct,
                skipped: result.skipped,
              },
            },
          }));
        }

        // Update local state optimistically
        setState(s => {
          const updatedScenes = s.scenes.map(sc =>
            sc.scene_number === result.scene_number
              ? { ...sc, status: result.status, error: result.error || null }
              : sc
          );
          const newDone = updatedScenes.filter(sc => sc.status === 'done').length;
          const newFailed = updatedScenes.filter(sc => sc.status === 'failed').length;
          const newQueued = updatedScenes.filter(sc => sc.status === 'queued').length;
          const newRunning = updatedScenes.filter(sc => sc.status === 'running').length;
          const actualPct = s.total > 0 ? (newDone / s.total) * 100 : 0;
          const avg = rollingAvg(durationsRef.current);
          const remaining = s.total - newDone - newFailed;
          return {
            ...s,
            scenes: updatedScenes,
            done: newDone,
            failed: newFailed,
            queued: newQueued,
            running: newRunning,
            smoothedPercent: Math.max(s.smoothedPercent, actualPct),
            lastProgressAt: Date.now(),
            avgUnitMs: avg > 0 ? avg : null,
            etaMs: avg > 0 && remaining > 0 ? avg * remaining : null,
          };
        });

        if (stopRef.current) break;

        // Full status refresh every 5 scenes
        if (scenesProcessed % 5 === 0) {
          const status = await callEngine('get_rewrite_status', { projectId, sourceVersionId, runId: currentRunId });
          setState(s => ({
            ...s,
            total: status.total,
            queued: status.queued,
            running: status.running,
            done: status.done,
            failed: status.failed,
            scenes: status.scenes || [],
            oldestRunningClaimedAt: status.oldest_running_claimed_at || null,
          }));
          if (status.queued === 0 && status.running === 0) break;
        }

        // Small delay between scenes
        await new Promise(r => setTimeout(r, 200));
      }

      // Final status
      const finalStatus = await callEngine('get_rewrite_status', { projectId, sourceVersionId, runId: currentRunId });
      const allDone = finalStatus.done === finalStatus.total;

      if (allDone && !stopRef.current && sourceDocId) {
        // ── Auto-assemble ──
        setState(s => ({ ...s, mode: 'assembling', smoothedPercent: 95 }));
        pushActivity('info', 'All scenes done — auto-assembling…');

        try {
          const assembleResult = await callEngine('assemble_rewritten_script', {
            projectId, sourceDocId, sourceVersionId,
            runId: currentRunId,
            rewriteModeSelected: 'auto',
            rewriteModeEffective: 'scene',
            rewriteModeReason: 'auto_probe_scene',
          });
          setState(s => ({
            ...s,
            mode: 'complete',
            newVersionId: assembleResult.newVersionId,
            smoothedPercent: 100,
            etaMs: null,
            lastAssembledVersionLabel: assembleResult.newVersionLabel || null,
            lastAssembledChangeSummary: assembleResult.newChangeSummary || null,
            lastAssembledVersionNumber: assembleResult.newVersionNumber || null,
            lastAssembledSelective: assembleResult.trulySelective ?? null,
            lastAssembledTargetCount: assembleResult.targetScenesCount ?? null,
          }));
          invalidate();
          // Clear persisted runId on successful assemble
          if (projectId) clearRunId(projectId, sourceVersionId);
          runIdRef.current = null;
          pushActivity('success', `Assembled ${assembleResult.scenesCount} scenes → ${assembleResult.charCount?.toLocaleString()} chars (is_current=true)`);
          toast.success(`Assembled → ${assembleResult.newVersionLabel || 'new version'}`);
        } catch (assembleErr: any) {
          setState(s => ({ ...s, mode: 'error', error: `Assemble failed: ${assembleErr.message}` }));
          pushActivity('error', `Auto-assemble failed: ${assembleErr.message}`);
          toast.error(`Auto-assemble failed: ${assembleErr.message}`);
        }
      } else {
        setState(s => ({
          ...s,
          ...finalStatus,
          scenes: finalStatus.scenes || [],
          oldestRunningClaimedAt: finalStatus.oldest_running_claimed_at || null,
          mode: allDone ? 'complete' : (finalStatus.failed > 0 ? 'error' : 'idle'),
          error: finalStatus.failed > 0 ? `${finalStatus.failed} scene(s) failed` : null,
          smoothedPercent: allDone ? 100 : s.smoothedPercent,
          etaMs: allDone ? null : s.etaMs,
        }));

        if (allDone) {
          pushActivity('success', `All ${finalStatus.total} scenes rewritten (assemble pending — no sourceDocId provided)`);
        } else if (finalStatus.failed > 0) {
          pushActivity('warn', `${finalStatus.failed} scene(s) failed — retry available`);
          toast.warning(`${finalStatus.failed} scene(s) failed. You can retry them.`);
        }
      }
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      pushActivity('error', `Processing error: ${err.message}`);
      toast.error(`Scene rewrite error: ${err.message}`);
    } finally {
      processingRef.current = false;
      stopSmoothing();
    }
  }, [projectId, pushActivity, startSmoothing, stopSmoothing, invalidate]);

  const stop = useCallback(() => {
    stopRef.current = true;
    stopSmoothing();
    pushActivity('warn', 'Processing stopped by user');
  }, [stopSmoothing, pushActivity]);

  const retryFailed = useCallback(async (sourceVersionId: string) => {
    if (!projectId) return;
    try {
      const result = await callEngine('retry_failed_rewrite_jobs', { projectId, sourceVersionId });
      pushActivity('info', `Re-queued ${result.reset} failed scene(s)`);
      toast.success(`${result.reset} failed scene(s) re-queued`);
      await loadStatus(sourceVersionId);
    } catch (err: any) {
      pushActivity('error', `Retry failed: ${err.message}`);
      toast.error(err.message);
    }
  }, [projectId, loadStatus, pushActivity]);

  const assemble = useCallback(async (sourceDocId: string, sourceVersionId: string, provenance?: Partial<RewriteProvenance>) => {
    if (!projectId) return;
    setState(s => ({ ...s, mode: 'assembling' }));
    pushActivity('info', state.scopePlan
      ? `Assembling (selective: ${state.scopePlan.target_scene_numbers.length} rewritten scenes)…`
      : 'Assembling final script…');
    try {
      let currentRunId = runIdRef.current;
      if (!currentRunId && projectId) {
        currentRunId = loadRunId(projectId, sourceVersionId);
        if (!currentRunId) currentRunId = await fetchLatestRunId(projectId, sourceVersionId);
        if (currentRunId) {
          runIdRef.current = currentRunId;
          pushActivity('info', `Recovered runId for assembly: ${currentRunId.slice(0, 8)}`);
        }
      }
      if (!currentRunId) throw new Error('Missing runId — please enqueue again.');
      const result = await callEngine('assemble_rewritten_script', {
        projectId, sourceDocId, sourceVersionId,
        runId: currentRunId,
        rewriteModeSelected: provenance?.rewriteModeSelected || state.selectedRewriteMode || 'auto',
        rewriteModeEffective: provenance?.rewriteModeEffective || 'scene',
        rewriteModeReason: provenance?.rewriteModeReason || 'auto_probe_scene',
        rewriteModeDebug: provenance?.rewriteModeDebug || null,
        rewriteProbe: provenance?.rewriteProbe || state.probeResult || null,
        rewriteScopePlan: provenance?.rewriteScopePlan || state.scopePlan || null,
        rewriteScopeExpandedFrom: provenance?.rewriteScopeExpandedFrom || state.scopeExpandedFrom || null,
        rewriteVerification: provenance?.rewriteVerification || state.verification || null,
      });
      setState(s => ({
        ...s,
        mode: 'complete',
        newVersionId: result.newVersionId,
        smoothedPercent: 100,
        etaMs: null,
        lastAssembledVersionLabel: result.newVersionLabel || null,
        lastAssembledChangeSummary: result.newChangeSummary || null,
        lastAssembledVersionNumber: result.newVersionNumber || null,
        lastAssembledSelective: result.trulySelective ?? null,
        lastAssembledTargetCount: result.targetScenesCount ?? null,
      }));
      invalidate();
      // Clear persisted runId on successful assemble
      if (projectId) clearRunId(projectId, sourceVersionId);
      runIdRef.current = null;
      const label = result.newVersionLabel || `${result.scenesCount} scenes`;
      const selectiveNote = result.trulySelective ? ` (${result.scenesCount}/${result.totalScenesInAssembly} selective)` : '';
      pushActivity('success', `Assembled ${result.scenesCount} scenes${selectiveNote} → ${result.charCount.toLocaleString()} chars`);
      toast.success(`Assembled → ${label}`);
      return result;
    } catch (err: any) {
      setState(s => ({ ...s, mode: 'error', error: err.message }));
      pushActivity('error', `Assemble failed: ${err.message}`);
      toast.error(err.message);
      return null;
    }
  }, [projectId, invalidate, pushActivity, state.selectedRewriteMode, state.probeResult, state.scopePlan, state.scopeExpandedFrom, state.verification]);

  // Plan scope: call backend scope_plan action for real contracts
  const planScope = useCallback(async (
    sourceDocId: string,
    sourceVersionId: string,
    notes: any[],
  ): Promise<RewriteScopePlan | null> => {
    if (!projectId) return null;
    try {
      pushActivity('info', 'Computing scope plan…');
      const result = await callEngine('scope_plan', {
        projectId, sourceDocId, sourceVersionId, notes,
      });
      const plan: RewriteScopePlan = {
        target_scene_numbers: result.target_scene_numbers || [],
        context_scene_numbers: result.context_scene_numbers || [],
        at_risk_scene_numbers: result.at_risk_scene_numbers || [],
        reason: result.reason || '',
        propagation_depth: result.propagation_depth || 0,
        note_ids: result.note_ids || [],
        contracts: result.contracts || { arc_milestones: [], canon_rules: [], knowledge_state: [], setup_payoff: [] },
        debug: result.debug || { selected_notes_count: notes.length, anchored_scenes: [], timestamp: new Date().toISOString() },
      };
      setState(s => ({
        ...s,
        scopePlan: plan,
        totalScenesInScript: result.total_scenes_in_script || 0,
        targetSceneNumbers: plan.target_scene_numbers,
      }));
      pushActivity('success', `Scope plan: ${plan.target_scene_numbers.length} target, ${plan.context_scene_numbers.length} context scenes (${result.contracts?.canon_rules?.length || 0} canon rules, ${result.contracts?.arc_milestones?.length || 0} arc milestones)`);
      return plan;
    } catch (err: any) {
      pushActivity('error', `Scope plan failed: ${err.message}`);
      // Fallback: local heuristic
      pushActivity('warn', 'Falling back to local scope planner');
      return localPlanScope(notes);
    }
  }, [projectId, pushActivity]);

  // Local fallback scope planner (no contracts)
  const localPlanScope = useCallback((notes: any[]): RewriteScopePlan => {
    const allNumbers = state.scenes.map(s => s.scene_number);
    return {
      target_scene_numbers: allNumbers,
      context_scene_numbers: [],
      at_risk_scene_numbers: [],
      reason: 'Fallback: rewriting all scenes (backend scope plan unavailable)',
      propagation_depth: 0,
      note_ids: notes.map((n: any) => n.id || n.note_key || '').filter(Boolean),
      contracts: { arc_milestones: [], canon_rules: [], knowledge_state: [], setup_payoff: [] },
      debug: { selected_notes_count: notes.length, anchored_scenes: [], timestamp: new Date().toISOString() },
    };
  }, [state.scenes]);

  // Set scope plan in state
  const setScopePlan = useCallback((plan: RewriteScopePlan | null) => {
    setState(s => ({ ...s, scopePlan: plan }));
  }, []);

  // Verify rewrite
  const verify = useCallback(async (sourceVersionId: string): Promise<RewriteVerification | null> => {
    if (!projectId) return null;
    try {
      const result = await callEngine('verify_rewrite', {
        projectId, sourceVersionId,
        scopePlan: state.scopePlan,
      });
      const verification: RewriteVerification = {
        pass: result.pass,
        failures: result.failures || [],
        timestamp: result.timestamp,
      };
      setState(s => ({ ...s, verification }));
      if (verification.pass) {
        pushActivity('success', 'Verification passed ✓');
      } else {
        pushActivity('warn', `Verification found ${verification.failures.length} issue(s)`);
      }
      return verification;
    } catch (err: any) {
      pushActivity('error', `Verification failed: ${err.message}`);
      return null;
    }
  }, [projectId, state.scopePlan, pushActivity]);

  // Expand scope after verification failure
  const expandAndContinue = useCallback(async (
    sourceDocId: string,
    sourceVersionId: string,
    failures: RewriteVerification['failures'],
    approvedNotes: any[],
    protectItems: string[],
  ) => {
    if (!projectId || !state.scopePlan) return false;
    if (state.expansionCount >= 3) {
      pushActivity('error', 'Max scope expansions (3) reached — manual widening required');
      toast.warning('Max automatic scope expansions reached. Use "Widen scope" to proceed.');
      return false;
    }

    // Collect scene numbers from failures
    const failureScenes = new Set<number>();
    for (const f of failures) {
      if (f.scene_numbers) f.scene_numbers.forEach(n => failureScenes.add(n));
    }

    // Add ±1 around failure scenes
    const allSceneNumbers = state.scenes.map(s => s.scene_number);
    const allSet = new Set(allSceneNumbers);
    const expandedTargets = new Set(failureScenes);
    for (const n of failureScenes) {
      if (allSet.has(n - 1)) expandedTargets.add(n - 1);
      if (allSet.has(n + 1)) expandedTargets.add(n + 1);
    }

    // Query backend for already-enqueued scene numbers to avoid duplicates
    let alreadyEnqueued = new Set<number>();
    try {
      const enqResult = await callEngine('get_enqueued_scene_numbers', { projectId, sourceVersionId });
      alreadyEnqueued = new Set(enqResult.scene_numbers || []);
    } catch { /* non-critical */ }

    // Remove scenes already enqueued
    const newTargets = [...expandedTargets].filter(n => !alreadyEnqueued.has(n));

    if (newTargets.length === 0) {
      pushActivity('info', 'No new scenes to expand to — verification issues may need manual attention');
      return false;
    }

    const previousTargets = state.scopePlan.target_scene_numbers;
    setState(s => ({
      ...s,
      scopeExpandedFrom: previousTargets,
      expansionCount: s.expansionCount + 1,
      scopePlan: s.scopePlan ? {
        ...s.scopePlan,
        target_scene_numbers: [...new Set([...s.scopePlan.target_scene_numbers, ...newTargets])].sort((a, b) => a - b),
        propagation_depth: s.scopePlan.propagation_depth + 1,
        reason: `Expanded from ${previousTargets.length} to ${previousTargets.length + newTargets.length} scenes after verification failure`,
      } : null,
    }));

    pushActivity('warn', `Expanding scope: +${newTargets.length} scenes (expansion ${state.expansionCount + 1}/3)`);

    // Enqueue only new targets
    const enqResult = await enqueue(sourceDocId, sourceVersionId, approvedNotes, protectItems, newTargets);
    if (enqResult) {
      processAll(sourceVersionId);
    }
    return true;
  }, [projectId, state.scopePlan, state.expansionCount, state.scenes, enqueue, processAll, pushActivity]);

  // Requeue stuck jobs
  const requeueStuck = useCallback(async (sourceVersionId: string, stuckMinutes = 10) => {
    if (!projectId) return;
    try {
      const result = await callEngine('requeue_stuck_rewrite_jobs', { projectId, sourceVersionId, stuckMinutes });
      pushActivity('warn', `Requeued ${result.requeued} stuck job(s)`);
      toast.success(`${result.requeued} stuck job(s) requeued`);
      await loadStatus(sourceVersionId);
    } catch (err: any) {
      pushActivity('error', `Requeue stuck failed: ${err.message}`);
      toast.error(err.message);
    }
  }, [projectId, loadStatus, pushActivity]);

  // Preview assembled output
  const preview = useCallback(async (sourceVersionId: string, maxChars = 8000): Promise<PreviewResult | null> => {
    if (!projectId) return null;
    try {
      return await callEngine('preview_assembled_rewrite', { projectId, sourceVersionId, maxChars }) as PreviewResult;
    } catch (err: any) {
      toast.error(err.message);
      return null;
    }
  }, [projectId]);

  const reset = useCallback(() => {
    stopRef.current = true;
    stopSmoothing();
    // Clear persisted runId from sessionStorage
    if (projectId && lastSourceVersionIdRef.current) {
      clearRunId(projectId, lastSourceVersionIdRef.current);
    }
    setState(initialState);
    durationsRef.current = [];
    runIdRef.current = null;
    lastSourceVersionIdRef.current = null;
  }, [stopSmoothing, projectId]);

  const isSelective = state.scopePlan != null && state.targetSceneNumbers.length > 0 && state.targetSceneNumbers.length < state.totalScenesInScript;
  const actualPercent = state.total > 0 ? Math.floor((state.done / state.total) * 100) : 0;

  const progress = {
    phase: state.mode === 'probing' ? 'probing'
      : state.mode === 'enqueuing' ? 'enqueuing'
      : state.mode === 'processing' ? 'processing_scene'
      : state.mode === 'assembling' ? 'assembling'
      : state.mode === 'complete' ? 'complete'
      : state.mode === 'error' ? 'error'
      : 'queued',
    total: state.total,
    completed: state.done,
    running: state.running,
    failed: state.failed,
    queued: state.queued,
    percent: actualPercent,
    label: state.mode === 'probing' ? 'Probing scenes…'
      : state.mode === 'enqueuing' ? (isSelective
          ? `Enqueuing ${state.targetSceneNumbers.length} target scenes…`
          : 'Splitting into scenes…')
      : state.mode === 'processing' ? (isSelective
          ? `Target scenes: ${state.done}/${state.total}`
          : `Scene ${state.done}/${state.total}`)
      : state.mode === 'assembling' ? (isSelective
          ? `Assembling (${state.targetSceneNumbers.length} rewritten / ${state.totalScenesInScript} total)…`
          : 'Assembling final script…')
      : state.mode === 'complete' ? 'Complete'
      : state.mode === 'error' ? (state.error || 'Error')
      : '',
  };

  return {
    ...state,
    probe,
    loadStatus,
    enqueue,
    processAll,
    stop,
    retryFailed,
    assemble,
    requeueStuck,
    preview,
    reset,
    setSelectedRewriteMode,
    isProcessing: processingRef.current,
    // Scope plan
    planScope,
    setScopePlan,
    verify,
    expandAndContinue,
    // Progress exports
    progress,
    activityItems,
    clearActivity,
    pushActivity,
  };
}
