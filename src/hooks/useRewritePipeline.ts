import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDevEngine } from '@/lib/invalidateDevEngine';
import type { ActivityItem } from '@/components/devengine/ActivityTimeline';

interface ChunkMetaItem {
  chunk_index: number;
  chunk_key: string;
  label: string;
  episode_start?: number | null;
  episode_end?: number | null;
  section_id?: string | null;
}

interface RewritePipelineState {
  status: 'idle' | 'planning' | 'writing' | 'assembling' | 'complete' | 'error';
  totalChunks: number;
  currentChunk: number;
  error: string | null;
  newVersionId: string | null;
  // Progress / ETA / smoothing
  etaMs: number | null;
  avgUnitMs: number | null;
  smoothedPercent: number;
  lastProgressAt: number;
  // Episode-aware metadata
  strategy: string;
  chunkMeta: ChunkMetaItem[];
  episodeCount: number | null;
  currentEpisodeStart: number | null;
  currentEpisodeEnd: number | null;
}

async function callEngine(action: string, extra: Record<string, any> = {}, retries = 2) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
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
        const lastBrace = text.lastIndexOf('}');
        if (lastBrace > 0) {
          try { result = JSON.parse(text.substring(0, lastBrace + 1)); } catch {
            throw new Error('Invalid response from engine');
          }
        } else {
          throw new Error('Invalid response from engine');
        }
      }
      if (!resp.ok) throw new Error(result.error || `Engine error (${resp.status})`);
      return result;
    } catch (err: any) {
      lastError = err;
      if (err.name === 'AbortError') {
        throw new Error('Engine request timed out (120s)');
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError || new Error('Unknown engine error');
}

function rollingAvg(arr: number[]): number {
  if (arr.length === 0) return 0;
  const recent = arr.slice(-5);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

/** Build a human-readable label for the current chunk based on strategy */
function buildChunkLabel(
  strategy: string,
  chunkMeta: ChunkMetaItem[],
  currentChunk: number,
  totalChunks: number,
  currentEpStart: number | null,
  currentEpEnd: number | null,
): string {
  if (strategy === 'episodic_indexed' && currentEpStart != null && currentEpEnd != null) {
    if (currentEpStart === currentEpEnd) {
      return `Rewriting Episode ${currentEpStart} — Episode ${currentChunk} of ${totalChunks} affected`;
    }
    return `Rewriting Episodes ${currentEpStart}–${currentEpEnd} (${currentChunk}/${totalChunks})`;
  }
  return `Chunk ${currentChunk}/${totalChunks}`;
}

/** Build a human-readable activity message for a completed chunk */
function buildChunkDoneMessage(
  strategy: string,
  chunkIndex: number,
  totalChunks: number,
  episodeStart: number | null,
  episodeEnd: number | null,
  durationSec: string,
): string {
  if (strategy === 'episodic_indexed' && episodeStart != null && episodeEnd != null) {
    if (episodeStart === episodeEnd) {
      return `Episode ${episodeStart} done (${durationSec}s)`;
    }
    return `Episodes ${episodeStart}–${episodeEnd} done (${durationSec}s)`;
  }
  return `Chunk ${chunkIndex + 1}/${totalChunks} done (${durationSec}s)`;
}

export function useRewritePipeline(projectId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<RewritePipelineState>({
    status: 'idle', totalChunks: 0, currentChunk: 0, error: null, newVersionId: null,
    etaMs: null, avgUnitMs: null, smoothedPercent: 0, lastProgressAt: 0,
    strategy: 'legacy_slugline', chunkMeta: [], episodeCount: null,
    currentEpisodeStart: null, currentEpisodeEnd: null,
  });
  const runningRef = useRef(false);
  const startGuardRef = useRef(false);
  const durationsRef = useRef<number[]>([]);
  const smoothingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const pushActivity = useCallback((level: ActivityItem['level'], message: string) => {
    setActivityItems(prev => [...prev, { level, message, ts: new Date().toISOString() }]);
  }, []);
  const clearActivity = useCallback(() => setActivityItems([]), []);

  const invalidate = useCallback(() => {
    if (!projectId) return;
    invalidateDevEngine(qc, { projectId });
    qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.some(k => k === 'dev-v2-versions') });
  }, [qc, projectId]);

  const startSmoothing = useCallback(() => {
    if (smoothingTimerRef.current) clearInterval(smoothingTimerRef.current);
    smoothingTimerRef.current = setInterval(() => {
      setState(s => {
        if (s.status !== 'writing') return s;
        const elapsed = Date.now() - s.lastProgressAt;
        if (elapsed < 2500) return s;
        const actualPct = s.totalChunks > 0 ? (s.currentChunk / s.totalChunks) * 100 : 0;
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

  const startRewrite = useCallback(async (
    documentId: string,
    versionId: string,
    approvedNotes: any[],
    protectItems: string[],
    provenance?: { rewriteModeSelected?: string; rewriteModeEffective?: string; rewriteModeReason?: string; rewriteModeDebug?: any; rewriteProbe?: any },
  ) => {
    if (!projectId || runningRef.current) return;
    if (startGuardRef.current) return;
    startGuardRef.current = true;
    runningRef.current = true;
    durationsRef.current = [];

    pushActivity('info', 'Rewrite started');

    try {
      // Step 1: Plan
      setState(s => ({ ...s, status: 'planning', error: null, newVersionId: null, smoothedPercent: 0, lastProgressAt: Date.now(),
        strategy: 'legacy_slugline', chunkMeta: [], episodeCount: null, currentEpisodeStart: null, currentEpisodeEnd: null }));
      pushActivity('info', 'Planning rewrite…');

      const plan = await callEngine('rewrite-plan', {
        projectId, documentId, versionId, approvedNotes, protectItems,
      });

      const { planRunId, totalChunks, strategy: planStrategy, chunkMeta: planChunkMeta, episodeCount: planEpisodeCount } = plan;
      const resolvedStrategy = planStrategy || 'legacy_slugline';
      const resolvedChunkMeta: ChunkMetaItem[] = planChunkMeta || [];
      const resolvedEpisodeCount = planEpisodeCount || null;

      setState(s => ({ ...s, status: 'writing', totalChunks, currentChunk: 0,
        strategy: resolvedStrategy, chunkMeta: resolvedChunkMeta, episodeCount: resolvedEpisodeCount }));

      if (resolvedStrategy === 'episodic_indexed' && resolvedEpisodeCount) {
        pushActivity('info', `Plan ready: ${totalChunks} affected episodes`);
      } else {
        pushActivity('info', `Plan ready: ${totalChunks} chunks`);
      }
      startSmoothing();

      // Step 2: Write chunks
      let previousChunkEnding = '';
      const rewrittenChunks: string[] = [];

      for (let i = 0; i < totalChunks; i++) {
        const chunkStart = Date.now();
        const meta = resolvedChunkMeta[i] || null;
        const epStart = meta?.episode_start ?? null;
        const epEnd = meta?.episode_end ?? null;

        setState(s => ({ ...s, currentChunk: i + 1, currentEpisodeStart: epStart, currentEpisodeEnd: epEnd }));

        const result = await callEngine('rewrite-chunk', {
          planRunId,
          chunkIndex: i,
          previousChunkEnding: previousChunkEnding.slice(-2000),
        });

        const chunkMs = Date.now() - chunkStart;
        durationsRef.current.push(chunkMs);

        rewrittenChunks.push(result.rewrittenText);
        previousChunkEnding = result.rewrittenText;

        const actualPct = ((i + 1) / totalChunks) * 100;
        const avg = rollingAvg(durationsRef.current);
        const remaining = totalChunks - (i + 1);

        setState(s => ({
          ...s,
          smoothedPercent: Math.max(s.smoothedPercent, actualPct),
          lastProgressAt: Date.now(),
          avgUnitMs: avg > 0 ? avg : null,
          etaMs: avg > 0 && remaining > 0 ? avg * remaining : null,
        }));

        // Use episode-aware message
        const resultEpStart = result.episodeStart ?? epStart;
        const resultEpEnd = result.episodeEnd ?? epEnd;
        pushActivity('success', buildChunkDoneMessage(
          resolvedStrategy, i, totalChunks, resultEpStart, resultEpEnd,
          (chunkMs / 1000).toFixed(1),
        ));
      }

      stopSmoothing();
      setState(s => ({ ...s, status: 'assembling', smoothedPercent: 95 }));
      pushActivity('info', 'Assembling final text…');
      const assembledText = rewrittenChunks.join('\n\n');

      // ── Immediate display: inject assembled content into cache NOW,
      // before the backend save completes. The user sees the document
      // immediately; the cache refreshes naturally when the real version lands.
      if (assembledText.length > 100) {
        qc.setQueriesData(
          { predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.some((k) => k === 'dev-v2-versions' || k === documentId) },
          (old: any) => {
            if (!Array.isArray(old)) return old;
            return old.map((v: any) =>
              v.id === versionId ? { ...v, plaintext: assembledText } : v
            );
          }
        );
        // Also mark pipeline as 95% done visually so spinner is nearly stopped
        setState(s => ({ ...s, smoothedPercent: 99 }));
      }

      const assembleResult = await callEngine('rewrite-assemble', {
        projectId, documentId, versionId, planRunId, assembledText,
        rewriteModeSelected: provenance?.rewriteModeSelected || 'auto',
        rewriteModeEffective: provenance?.rewriteModeEffective || 'chunk',
        rewriteModeReason: provenance?.rewriteModeReason || 'auto_probe_chunk',
        rewriteModeDebug: provenance?.rewriteModeDebug || null,
        rewriteProbe: provenance?.rewriteProbe || null,
      });

      // Show runtime warning from server if present
      if (assembleResult.runtimeWarning) {
        toast.warning(assembleResult.runtimeWarning);
      }

      setState(s => ({
        ...s, status: 'complete', newVersionId: assembleResult.newVersion?.id || null,
        smoothedPercent: 100, etaMs: null,
      }));

      invalidate();
      const mins = assembleResult.estimatedMinutes ? ` (~${assembleResult.estimatedMinutes} mins)` : '';
      pushActivity('success', `Rewrite complete — ${assembledText.length.toLocaleString()} chars${mins}`);
      toast.success(`Full rewrite complete — ${assembledText.length.toLocaleString()} chars${mins}`);

    } catch (err: any) {
      console.error('Rewrite pipeline error:', err);
      setState(s => ({ ...s, status: 'error', error: err.message }));
      pushActivity('error', `Rewrite error: ${err.message}`);
      toast.error(`Rewrite error: ${err.message}`);
    } finally {
      runningRef.current = false;
      startGuardRef.current = false;
      stopSmoothing();
    }
  }, [projectId, invalidate, pushActivity, startSmoothing, stopSmoothing]);

  const reset = useCallback(() => {
    setState({
      status: 'idle', totalChunks: 0, currentChunk: 0, error: null, newVersionId: null,
      etaMs: null, avgUnitMs: null, smoothedPercent: 0, lastProgressAt: 0,
      strategy: 'legacy_slugline', chunkMeta: [], episodeCount: null,
      currentEpisodeStart: null, currentEpisodeEnd: null,
    });
    stopSmoothing();
    durationsRef.current = [];
  }, [stopSmoothing]);

  const actualPercent = state.totalChunks > 0 ? Math.floor((state.currentChunk / state.totalChunks) * 100) : 0;

  const isEpisodic = state.strategy === 'episodic_indexed';
  const totalEpisodes = state.episodeCount ?? 0;
  const affectedEpisodes = state.totalChunks;
  const preservedEpisodes = totalEpisodes > affectedEpisodes ? totalEpisodes - affectedEpisodes : 0;

  const progress = {
    phase: state.status === 'planning'
      ? (isEpisodic ? 'processing_episode' : 'processing_chunk')
      : state.status === 'writing'
        ? (isEpisodic ? 'processing_episode' : 'processing_chunk')
        : state.status === 'assembling' ? 'assembling'
        : state.status === 'complete' ? 'complete'
        : state.status === 'error' ? 'error'
        : 'queued',
    total: state.totalChunks,
    completed: state.currentChunk,
    running: state.status === 'writing' ? 1 : 0,
    failed: 0,
    queued: state.totalChunks - state.currentChunk,
    percent: actualPercent,
    label: state.status === 'planning' ? 'Planning rewrite…'
      : state.status === 'writing' ? buildChunkLabel(
          state.strategy, state.chunkMeta, state.currentChunk, state.totalChunks,
          state.currentEpisodeStart, state.currentEpisodeEnd,
        )
      : state.status === 'assembling' ? 'Assembling…'
      : state.status === 'complete' ? 'Complete'
      : state.status === 'error' ? (state.error || 'Error')
      : '',
    // Episodic scope metadata
    isEpisodic,
    totalEpisodes,
    affectedEpisodes,
    preservedEpisodes,
  };

  return {
    ...state,
    startRewrite,
    reset,
    isRunning: runningRef.current,
    // New exports
    progress,
    activityItems,
    clearActivity,
    pushActivity,
  };
}
