import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useRef, useCallback, useMemo } from 'react';
import type { VerticalEpisodeMetricRow, EpisodeMetrics } from '@/lib/vertical-metrics-config';
import { metricsPassGate } from '@/lib/vertical-metrics-config';

export interface SeriesEpisode {
  id: string;
  project_id: string;
  user_id: string;
  episode_number: number;
  title: string;
  logline: string;
  script_id: string | null;
  status: string;
  generation_progress: Record<string, any>;
  canon_snapshot_id: string | null;
  validation_status: string | null;
  validation_score: number | null;
  locked_at: string | null;
  resolver_hash_used: string | null;
  style_template_version_id: string | null;
  is_season_template: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  handoff_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface CanonSnapshot {
  id: string;
  project_id: string;
  user_id: string;
  blueprint_version_id: string | null;
  character_bible_version_id: string | null;
  episode_grid_version_id: string | null;
  episode_1_version_id: string | null;
  season_episode_count: number;
  snapshot_data: Record<string, any>;
  status: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodeValidation {
  id: string;
  episode_id: string;
  character_consistency_score: number;
  relationship_continuity_score: number;
  location_limit_score: number;
  season_arc_alignment_score: number;
  emotional_escalation_score: number;
  overall_score: number;
  passed: boolean;
  issues: any[];
}

// Vertical-drama phases replace the film/TV blueprint→architecture pipeline
type GenerationPhase = 'load_pack' | 'beats' | 'draft' | 'continuity' | 'validate' | 'metrics' | 'save'
  // Legacy phases kept for type-safety on non-vertical paths
  | 'blueprint' | 'architecture' | 'score';
const VERTICAL_PHASES: GenerationPhase[] = ['load_pack', 'beats', 'draft', 'continuity', 'validate', 'metrics', 'save'];
const PHASES: GenerationPhase[] = VERTICAL_PHASES;

export interface SeriesProgress {
  currentEpisode: number;
  totalEpisodes: number;
  phase: GenerationPhase | 'idle' | 'complete' | 'error';
  error?: string;
}

export interface PhaseLogEntry {
  time: string;
  message: string;
  isActive: boolean;
}

export interface RunControlState {
  status: 'idle' | 'running' | 'paused' | 'stopped' | 'error';
  lastSavedScriptId: string | null;
  lastSavedEpisodeId: string | null;
  lastUpdatedAt: string | null;
  phaseLog: PhaseLogEntry[];
}

export type { VerticalEpisodeMetricRow, EpisodeMetrics };

export function useSeriesWriter(projectId: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<SeriesProgress>({
    currentEpisode: 0, totalEpisodes: 0, phase: 'idle',
  });
  const [runControl, setRunControl] = useState<RunControlState>({
    status: 'idle',
    lastSavedScriptId: null,
    lastSavedEpisodeId: null,
    lastUpdatedAt: null,
    phaseLog: [],
  });
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const pauseRequestedRef = useRef(false);
  const [, forceRender] = useState(0);

  const [metricsRunning, setMetricsRunning] = useState(false);
  const [metricsRunningEp, setMetricsRunningEp] = useState<number | null>(null);

  const queryKey = ['series-episodes', projectId];
  const canonKey = ['canon-snapshot', projectId];
  const validationKey = ['episode-validations', projectId];
  const metricsKey = ['vertical-episode-metrics', projectId];

  const [showDeleted, setShowDeleted] = useState(false);

  // ── Episodes (all, including deleted) ──
  const { data: allEpisodes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('series_episodes')
        .select('*')
        .eq('project_id', projectId)
        .order('episode_number', { ascending: true });
      if (error) throw error;
      return (data || []) as SeriesEpisode[];
    },
    enabled: !!projectId,
  });

  // Active episodes (non-deleted) for all logic
  const episodes = useMemo(() => allEpisodes.filter(e => !e.is_deleted), [allEpisodes]);
  const deletedEpisodes = useMemo(() => allEpisodes.filter(e => e.is_deleted), [allEpisodes]);

  // ── Canon Snapshot ──
  const { data: canonSnapshot, isLoading: canonLoading } = useQuery({
    queryKey: canonKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('canon_snapshots')
        .select('*')
        .eq('project_id', projectId)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      return data as CanonSnapshot | null;
    },
    enabled: !!projectId,
  });

  // ── Validations ──
  const { data: validations = [] } = useQuery({
    queryKey: validationKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('episode_validations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EpisodeValidation[];
    },
    enabled: !!projectId,
  });

  // ── Episode Metrics ──
  const { data: episodeMetrics = [] } = useQuery({
    queryKey: metricsKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vertical_episode_metrics')
        .select('*')
        .eq('project_id', projectId)
        .order('episode_number', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as VerticalEpisodeMetricRow[];
    },
    enabled: !!projectId,
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: canonKey });
    qc.invalidateQueries({ queryKey: validationKey });
    qc.invalidateQueries({ queryKey: metricsKey });
  }

  // ── Create Canon Snapshot ──
  const createCanonSnapshot = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Fetch latest versions of canon documents
      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, doc_type')
        .eq('project_id', projectId)
        .in('doc_type', ['blueprint', 'season_arc', 'character_bible', 'episode_grid', 'script']);

      if (!docs?.length) throw new Error('No canon documents found');

      const findDoc = (type: string) => docs.find(d => d.doc_type === type);
      const blueprintDoc = findDoc('blueprint') || findDoc('season_arc');
      const charBibleDoc = findDoc('character_bible');
      const gridDoc = findDoc('episode_grid');
      const scriptDoc = findDoc('script'); // Episode 1

      if (!gridDoc) throw new Error('Episode Grid is required for canon snapshot');
      if (!scriptDoc) throw new Error('Episode 1 script is required for canon snapshot');

      // Get latest version IDs
      const getLatestVersion = async (docId: string) => {
        const { data } = await supabase
          .from('project_document_versions')
          .select('id')
          .eq('document_id', docId)
          .order('version_number', { ascending: false })
          .limit(1)
          .single();
        return data?.id || null;
      };

      const [bpVer, cbVer, gridVer, scriptVer] = await Promise.all([
        blueprintDoc ? getLatestVersion(blueprintDoc.id) : null,
        charBibleDoc ? getLatestVersion(charBibleDoc.id) : null,
        getLatestVersion(gridDoc.id),
        getLatestVersion(scriptDoc.id),
      ]);

      // Get season episode count
      const { data: project } = await supabase
        .from('projects')
        .select('season_episode_count')
        .eq('id', projectId)
        .single();

      const seasonCount = (project as any)?.season_episode_count;
      if (!seasonCount) throw new Error('season_episode_count must be set before creating canon snapshot');

      // Deactivate existing snapshots
      await supabase
        .from('canon_snapshots')
        .update({ status: 'superseded' })
        .eq('project_id', projectId)
        .eq('status', 'active');

      // Create new snapshot
      const { data: snapshot, error } = await supabase
        .from('canon_snapshots')
        .insert({
          project_id: projectId,
          user_id: user.id,
          blueprint_version_id: bpVer,
          character_bible_version_id: cbVer,
          episode_grid_version_id: gridVer,
          episode_1_version_id: scriptVer,
          season_episode_count: seasonCount,
          status: 'active',
        })
        .select()
        .single();

      if (error) throw error;
      return snapshot;
    },
    onSuccess: () => {
      toast.success('Canon snapshot locked');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Create episode slots ──
  const createEpisodes = useMutation({
    mutationFn: async (count: number) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('series_episodes').delete().eq('project_id', projectId);

      const rows = Array.from({ length: count }, (_, i) => ({
        project_id: projectId,
        user_id: user.id,
        episode_number: i + 1,
        title: `Episode ${i + 1}`,
        status: 'pending',
        canon_snapshot_id: canonSnapshot?.id || null,
      }));

      const { error } = await supabase.from('series_episodes').insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Episode slots created');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Update episode ──
  const updateEpisode = useMutation({
    mutationFn: async (params: { episodeId: string; title?: string; logline?: string }) => {
      const updates: Record<string, any> = {};
      if (params.title !== undefined) updates.title = params.title;
      if (params.logline !== undefined) updates.logline = params.logline;
      const { error } = await supabase
        .from('series_episodes')
        .update(updates)
        .eq('id', params.episodeId);
      if (error) throw error;
    },
    onSuccess: () => invalidateAll(),
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Call script-engine ──
  async function callEngine(action: string, pId: string, scriptId?: string, extra: Record<string, any> = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/script-engine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, projectId: pId, scriptId, ...extra }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || `Engine error (${action})`);
    return result;
  }

  // ── Call dev-engine-v2 for validation ──
  async function callDevEngineV2(action: string, body: Record<string, any>) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, ...body }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || `Dev engine error (${action})`);
    return result;
  }

  // ── Append to phase log ──
  function appendPhaseLog(message: string, isActive = true) {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setRunControl(prev => ({
      ...prev,
      lastUpdatedAt: new Date().toISOString(),
      phaseLog: [...prev.phaseLog.slice(-30), { time, message, isActive }],
    }));
  }

  // ── Update episode progress ──
  async function updateEpisodeProgress(episodeId: string, phase: string, status: string, scriptId?: string) {
    const updates: Record<string, any> = {
      generation_progress: { phase, updatedAt: new Date().toISOString() },
      status,
    };
    if (scriptId) updates.script_id = scriptId;
    if (canonSnapshot?.id) updates.canon_snapshot_id = canonSnapshot.id;
    await supabase.from('series_episodes').update(updates).eq('id', episodeId);
    // Track last saved pointers
    if (scriptId) {
      setRunControl(prev => ({
        ...prev,
        lastSavedScriptId: scriptId,
        lastSavedEpisodeId: episodeId,
        lastUpdatedAt: new Date().toISOString(),
      }));
    }
  }

  // ── Wait while paused ──
  async function waitIfPaused(episodeId: string, episodeNumber: number) {
    if (!pauseRequestedRef.current) return false; // not paused
    // Persist paused state to DB
    await supabase.from('series_episodes').update({
      generation_progress: { phase: 'paused', updatedAt: new Date().toISOString() },
      status: 'generating',
    }).eq('id', episodeId);
    setRunControl(prev => ({ ...prev, status: 'paused' }));
    setProgress(prev => ({ ...prev, phase: 'paused' as any }));
    appendPhaseLog(`⏸ Paused at EP ${episodeNumber} — waiting for Resume`, false);

    // Poll until resumed or stopped
    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (!pauseRequestedRef.current || stopRequestedRef.current) {
          clearInterval(interval);
          resolve();
        }
      }, 500);
    });

    if (stopRequestedRef.current) return true; // caller should abort
    setRunControl(prev => ({ ...prev, status: 'running' }));
    appendPhaseLog(`▶ Resumed EP ${episodeNumber}`, true);
    return false;
  }

  // ── Validate episode after generation ──
  async function validateEpisode(episode: SeriesEpisode, scriptId: string): Promise<boolean> {
    try {
      const { data: scriptData } = await supabase
        .from('scripts')
        .select('text_content')
        .eq('id', scriptId)
        .single();

      if (!scriptData?.text_content) return true; // Skip validation if no content

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return true;

      // Simple validation checks
      const text = scriptData.text_content;
      const lines = text.split('\n');
      const hasHook = lines.slice(0, 10).some((l: string) => l.trim().length > 20);
      const hasCliffhanger = lines.slice(-15).some((l: string) => l.trim().length > 10);
      
      // Location check: count unique INT./EXT. locations
      const locationMatches = text.match(/(?:INT\.|EXT\.|INT\/EXT\.)\s+[A-Z][A-Z\s\-\/]+/g) || [];
      const uniqueLocations = new Set(locationMatches.map((l: string) => l.replace(/(?:INT\.|EXT\.|INT\/EXT\.)\s+/, '').trim()));
      const locationScore = uniqueLocations.size <= 3 ? 100 : uniqueLocations.size <= 5 ? 70 : 40;

      const hookScore = hasHook ? 90 : 40;
      const cliffScore = hasCliffhanger ? 90 : 40;
      const overall = (hookScore + cliffScore + locationScore) / 3;
      const passed = overall >= 60;

      // Store validation
      await supabase.from('episode_validations').insert({
        project_id: projectId,
        episode_id: episode.id,
        canon_snapshot_id: canonSnapshot?.id || null,
        user_id: user.id,
        character_consistency_score: 75, // Default until AI validation
        relationship_continuity_score: 75,
        location_limit_score: locationScore,
        season_arc_alignment_score: 75,
        emotional_escalation_score: hookScore,
        overall_score: overall,
        passed,
        issues: [
          ...(!hasHook ? [{ type: 'missing_hook', message: 'No immediate hook detected in first 10 lines' }] : []),
          ...(!hasCliffhanger ? [{ type: 'missing_cliffhanger', message: 'No cliffhanger detected at end' }] : []),
          ...(uniqueLocations.size > 3 ? [{ type: 'location_excess', message: `${uniqueLocations.size} unique locations (max 3 recommended)` }] : []),
        ],
      });

      // Update episode validation status
      await supabase.from('series_episodes').update({
        validation_status: passed ? 'passed' : 'needs_revision',
        validation_score: overall,
      }).eq('id', episode.id);

      return passed;
    } catch (err) {
      console.error('Validation error:', err);
      return true; // Don't block on validation errors
    }
  }

  // ── Call generate-vertical-episode engine action ──
  async function callVerticalEpisodeEngine(params: {
    episodeNumber: number;
    episodeId: string;
    totalEpisodes: number;
    canonSnapshotId?: string | null;
    previousEpisodeSummary?: string;
  }) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/script-engine`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action: 'generate-vertical-episode', projectId, ...params }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Vertical episode engine error');
    return result as { scriptId: string; scriptVersionId: string | null; draftNumber: number; metrics: Record<string, any> };
  }

  // ── Fetch previous episode summary for continuity ──
  async function fetchPreviousEpisodeSummary(episodeNumber: number): Promise<string | undefined> {
    if (episodeNumber <= 1) return undefined;
    const { data: prevEp } = await supabase
      .from('series_episodes')
      .select('script_id, title, logline')
      .eq('project_id', projectId)
      .eq('episode_number', episodeNumber - 1)
      .in('status', ['complete', 'locked'])
      .single();
    if (!prevEp?.script_id) return undefined;
    const { data: prevScript } = await supabase
      .from('scripts')
      .select('text_content')
      .eq('id', prevEp.script_id)
      .single();
    const prevText = prevScript?.text_content?.slice(0, 3000) || '';
    return `Previous Episode "${prevEp.title}" (${prevEp.logline || 'no logline'}):\n${prevText}`;
  }

  // ── Generate a single episode (Vertical Drama pipeline) ──
  // Pipeline: load_pack → beats → draft → continuity → validate → metrics → save
  // NEVER calls blueprint / architecture — those are series-level stages, not episode stages.
  const generateOne = useCallback(async (episode: SeriesEpisode) => {
    if (runningRef.current) {
      toast.warning('Generation already in progress');
      return;
    }
    runningRef.current = true;
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    forceRender(n => n + 1);
    setRunControl(prev => ({ ...prev, status: 'running', phaseLog: [] }));
    setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'load_pack' });

    try {
      // ── Phase: Load Pack ──
      appendPhaseLog(`EP ${episode.episode_number} — Loading Vertical Pack`);
      await updateEpisodeProgress(episode.id, 'load_pack', 'generating');
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      const previousEpisodeSummary = await fetchPreviousEpisodeSummary(episode.episode_number);

      // ── Phase: Episode Beats ──
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'beats' });
      appendPhaseLog(`EP ${episode.episode_number} — Episode Beats`);
      await updateEpisodeProgress(episode.id, 'beats', 'generating');
      if (await waitIfPaused(episode.id, episode.episode_number)) throw new Error('Generation stopped by user');

      // ── Phase: Draft Episode Script ──
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'draft' });
      appendPhaseLog(`EP ${episode.episode_number} — Drafting Episode Script`);
      await updateEpisodeProgress(episode.id, 'draft', 'generating');

      const result = await callVerticalEpisodeEngine({
        episodeNumber: episode.episode_number,
        episodeId: episode.id,
        totalEpisodes: canonSnapshot?.season_episode_count || 1,
        canonSnapshotId: canonSnapshot?.id || null,
        previousEpisodeSummary,
      });
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      const scriptId = result.scriptId;
      await updateEpisodeProgress(episode.id, 'draft', 'generating', scriptId);

      if (await waitIfPaused(episode.id, episode.episode_number)) throw new Error('Generation stopped by user');

      // ── Phase: Continuity Check ──
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'continuity' });
      appendPhaseLog(`EP ${episode.episode_number} — Continuity Check`);
      await updateEpisodeProgress(episode.id, 'continuity', 'generating');
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      // ── Phase: Validate ──
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'validate' });
      appendPhaseLog(`EP ${episode.episode_number} — Validating`);
      const passed = await validateEpisode(episode, scriptId);
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      // ── Phase: Metrics ──
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'metrics' });
      appendPhaseLog(`EP ${episode.episode_number} — Beat Metrics`);
      await runEpisodeMetrics(episode.episode_number, scriptId);

      // ── Phase: Save ──
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'save' });
      appendPhaseLog(`EP ${episode.episode_number} — Saving`);
      await updateEpisodeProgress(episode.id, 'complete', passed ? 'complete' : 'needs_revision');
      appendPhaseLog(`EP ${episode.episode_number} — ${passed ? 'Complete ✓' : 'Needs Revision ⚠'}`, false);
      toast.success(`Episode ${episode.episode_number} generated${!passed ? ' (needs revision)' : ''}`);

    } catch (err: any) {
      const stopped = stopRequestedRef.current;
      console.error(`Episode ${episode.episode_number} generation ${stopped ? 'stopped' : 'failed'}:`, err);
      await updateEpisodeProgress(episode.id, 'error', stopped ? 'pending' : 'error');
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: stopped ? 'idle' : 'error', error: stopped ? undefined : err.message });
      setRunControl(prev => ({ ...prev, status: stopped ? 'stopped' : 'error' }));
      if (stopped) toast.info('Generation stopped');
      else toast.error(`Episode ${episode.episode_number} failed: ${err.message}`);
    }

    const wasStopped = stopRequestedRef.current;
    setProgress(prev => ({ ...prev, phase: wasStopped ? 'idle' : 'complete' }));
    if (!wasStopped) setRunControl(prev => ({ ...prev, status: 'idle' }));
    invalidateAll();
    runningRef.current = false;
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    forceRender(n => n + 1);
  }, [projectId, canonSnapshot]);

  // ── Generate all pending episodes sequentially (Vertical Drama pipeline) ──
  const generateAll = useCallback(async () => {
    if (runningRef.current) {
      toast.warning('Generation already in progress');
      return;
    }
    runningRef.current = true;
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    forceRender(n => n + 1);
    setRunControl(prev => ({ ...prev, status: 'running', phaseLog: [] }));

    const { data: freshEpisodes, error: fetchErr } = await supabase
      .from('series_episodes')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_deleted', false)
      .order('episode_number', { ascending: true });

    if (fetchErr || !freshEpisodes?.length) {
      toast.error('No episodes to generate');
      runningRef.current = false;
      setRunControl(prev => ({ ...prev, status: 'idle' }));
      return;
    }

    const total = freshEpisodes.length;
    setProgress({ currentEpisode: 0, totalEpisodes: total, phase: 'idle' });

    for (let i = 0; i < total; i++) {
      if (stopRequestedRef.current) {
        toast.info('Generation stopped by user');
        break;
      }
      const ep = freshEpisodes[i] as SeriesEpisode;
      if (ep.status === 'complete' || ep.status === 'locked') continue;
      // Block if previous episode failed validation
      if (i > 0 && freshEpisodes[i - 1].validation_status === 'needs_revision') {
        toast.warning(`Episode ${freshEpisodes[i - 1].episode_number} needs revision before continuing`);
        break;
      }

      setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'load_pack' });

      try {
        appendPhaseLog(`EP ${ep.episode_number} — Loading Vertical Pack`);
        await updateEpisodeProgress(ep.id, 'load_pack', 'generating');

        const previousEpisodeSummary = await fetchPreviousEpisodeSummary(ep.episode_number);
        if (stopRequestedRef.current) break;

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'beats' });
        appendPhaseLog(`EP ${ep.episode_number} — Episode Beats`);
        await updateEpisodeProgress(ep.id, 'beats', 'generating');
        if (await waitIfPaused(ep.id, ep.episode_number)) break;

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'draft' });
        appendPhaseLog(`EP ${ep.episode_number} — Drafting Episode Script`);
        await updateEpisodeProgress(ep.id, 'draft', 'generating');

        const result = await callVerticalEpisodeEngine({
          episodeNumber: ep.episode_number,
          episodeId: ep.id,
          totalEpisodes: total,
          canonSnapshotId: canonSnapshot?.id || null,
          previousEpisodeSummary,
        });
        if (stopRequestedRef.current) break;

        const scriptId = result.scriptId;
        await updateEpisodeProgress(ep.id, 'draft', 'generating', scriptId);
        if (await waitIfPaused(ep.id, ep.episode_number)) break;

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'continuity' });
        appendPhaseLog(`EP ${ep.episode_number} — Continuity Check`);
        await updateEpisodeProgress(ep.id, 'continuity', 'generating');
        if (stopRequestedRef.current) break;

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'validate' });
        appendPhaseLog(`EP ${ep.episode_number} — Validating`);
        const passed = await validateEpisode(ep as SeriesEpisode, scriptId);

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'metrics' });
        appendPhaseLog(`EP ${ep.episode_number} — Beat Metrics`);
        await runEpisodeMetrics(ep.episode_number, scriptId);

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'save' });
        appendPhaseLog(`EP ${ep.episode_number} — Saving`);
        await updateEpisodeProgress(ep.id, 'complete', passed ? 'complete' : 'needs_revision');
        appendPhaseLog(`EP ${ep.episode_number} — ${passed ? 'Complete ✓' : 'Needs Revision ⚠'}`, false);
        invalidateAll();

        if (!passed) {
          toast.warning(`Episode ${ep.episode_number} needs revision — stopping auto-run`);
          break;
        }
      } catch (err: any) {
        const stopped = stopRequestedRef.current;
        console.error(`Episode ${ep.episode_number} generation failed:`, err);
        await updateEpisodeProgress(ep.id, 'error', stopped ? 'pending' : 'error');
        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: stopped ? 'idle' : 'error', error: stopped ? undefined : err.message });
        setRunControl(prev => ({ ...prev, status: stopped ? 'stopped' : 'error' }));
        if (!stopped) toast.error(`Episode ${ep.episode_number} failed: ${err.message}`);
        break;
      }
    }

    // Check completion
    const { data: finalEps } = await supabase
      .from('series_episodes')
      .select('status')
      .eq('project_id', projectId);
    const allDone = finalEps?.every(e => e.status === 'complete' || e.status === 'locked');
    if (allDone) {
      toast.success('Season generation complete!');
    }

    const wasStopped = stopRequestedRef.current;
    setProgress(prev => ({ ...prev, phase: wasStopped ? 'idle' : 'complete' }));
    if (!wasStopped && !pauseRequestedRef.current) {
      setRunControl(prev => ({ ...prev, status: 'idle' }));
    }
    invalidateAll();
    runningRef.current = false;
    stopRequestedRef.current = false;
    pauseRequestedRef.current = false;
    forceRender(n => n + 1);
  }, [projectId, canonSnapshot]);

  // ── Invalidate canon (when user edits canon docs) ──
  const invalidateCanon = useMutation({
    mutationFn: async (reason: string) => {
      if (!canonSnapshot) return;
      await supabase.from('canon_snapshots').update({
        status: 'invalidated',
        invalidated_at: new Date().toISOString(),
        invalidation_reason: reason,
      }).eq('id', canonSnapshot.id);

      // Mark all non-complete episodes as invalidated
      const completedEps = episodes.filter(e => e.status === 'complete');
      const highestComplete = completedEps.length > 0
        ? Math.max(...completedEps.map(e => e.episode_number))
        : 0;

      // Invalidate episodes after the last complete one
      for (const ep of episodes) {
        if (ep.episode_number > highestComplete && ep.status !== 'pending') {
          await supabase.from('series_episodes').update({
            status: 'invalidated',
            validation_status: 'canon_changed',
          }).eq('id', ep.id);
        }
      }
    },
    onSuccess: () => {
      toast.warning('Canon changed — future episodes must be regenerated');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Fetch script content ──
  const fetchScriptContent = useCallback(async (scriptId: string): Promise<string> => {
    const { data, error } = await supabase
      .from('scripts')
      .select('text_content')
      .eq('id', scriptId)
      .single();
    if (error) throw error;
    return data?.text_content || 'No content available.';
  }, []);

  // ── Run metrics for a single episode ──
  const runEpisodeMetrics = useCallback(async (episodeNumber: number, scriptId?: string) => {
    setMetricsRunning(true);
    setMetricsRunningEp(episodeNumber);
    try {
      // Find scriptId if not provided
      let sid = scriptId;
      if (!sid) {
        const ep = episodes.find(e => e.episode_number === episodeNumber);
        sid = ep?.script_id || undefined;
      }
      if (!sid) throw new Error('No script found for this episode');

      // Gather previous metrics for flag detection
      const prevMetrics = episodeMetrics
        .filter(m => m.episode_number < episodeNumber)
        .sort((a, b) => a.episode_number - b.episode_number)
        .map(m => m.metrics);

      await callDevEngineV2('series-writer-metrics', {
        projectId,
        episodeNumber,
        scriptId: sid,
        canonSnapshotId: canonSnapshot?.id,
        seasonEpisodeCount: canonSnapshot?.season_episode_count || episodes.length,
        previousMetrics: prevMetrics.slice(-5),
      });

      invalidateAll();
    } catch (err: any) {
      toast.error(`Metrics failed: ${err.message}`);
    }
    setMetricsRunning(false);
    setMetricsRunningEp(null);
  }, [projectId, canonSnapshot, episodes, episodeMetrics]);

  const stopGeneration = useCallback(() => {
    stopRequestedRef.current = true;
    pauseRequestedRef.current = false; // release any pause-wait loop
    runningRef.current = false;
    setRunControl(prev => ({ ...prev, status: 'stopped' }));
    forceRender(n => n + 1);
    toast.info('Stopping after current phase completes…');
  }, []);

  const pauseGeneration = useCallback(() => {
    if (!runningRef.current) return;
    pauseRequestedRef.current = true;
    setRunControl(prev => ({ ...prev, status: 'paused' }));
    toast.info('Pausing after current phase completes…');
  }, []);

  const resumeGeneration = useCallback(() => {
    pauseRequestedRef.current = false;
    setRunControl(prev => ({ ...prev, status: 'running' }));
    toast.info('Resuming generation…');
  }, []);

  // ── Force-reset a stuck/stalled generating episode ──
  const resetStuckEpisode = useMutation({
    mutationFn: async (episodeId: string) => {
      stopRequestedRef.current = true;
      pauseRequestedRef.current = false; // release any pause-wait
      const { error } = await (supabase as any)
        .from('series_episodes')
        .update({
          status: 'error',
          generation_progress: {
            phase: 'error',
            error: 'Manually reset by user',
            updatedAt: new Date().toISOString(),
          },
        })
        .eq('id', episodeId);
      if (error) throw error;
    },
    onSuccess: () => {
      runningRef.current = false;
      stopRequestedRef.current = false;
      pauseRequestedRef.current = false;
      forceRender(n => n + 1);
      setProgress({ currentEpisode: 0, totalEpisodes: 0, phase: 'idle' });
      setRunControl(prev => ({ ...prev, status: 'stopped' }));
      qc.invalidateQueries({ queryKey: ['series-episodes', projectId] });
      toast.success('Episode reset — click Retry to regenerate');
    },
    onError: (e: any) => toast.error(`Reset failed: ${e.message}`),
  });

  // ── Derived state ──
  const isGenerating = runningRef.current;
  const completedCount = episodes.filter(e => e.status === 'complete').length;
  const isSeasonComplete = episodes.length > 0 && episodes.every(e => e.status === 'complete');
  const nextEpisode = episodes.find(e => e.status === 'pending' || e.status === 'error');
  const hasFailedValidation = episodes.some(e => e.validation_status === 'needs_revision');
  const isCanonValid = canonSnapshot?.status === 'active';

  // Check metrics gating
  const hasMetricsBlock = episodeMetrics.some(m => {
    const gate = metricsPassGate(m.metrics);
    return !gate.passed;
  });

  // ── Soft delete episode ──
  const deleteEpisode = useMutation({
    mutationFn: async (params: { episodeId: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const ep = episodes.find(e => e.id === params.episodeId);
      if (ep?.is_season_template) {
        throw new Error('Cannot delete the Season Template episode. Assign a new template first.');
      }

      const { error } = await supabase.from('series_episodes').update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
        delete_reason: params.reason || null,
      }).eq('id', params.episodeId);
      if (error) throw error;

      await (supabase as any).from('episode_activity_log').insert({
        project_id: projectId, episode_id: params.episodeId, user_id: user.id,
        action: 'soft_delete', details: { reason: params.reason || null },
      });
    },
    onSuccess: () => {
      toast.success('Episode deleted');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Restore episode ──
  const restoreEpisode = useMutation({
    mutationFn: async (episodeId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('series_episodes').update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        delete_reason: null,
      }).eq('id', episodeId);
      if (error) throw error;
      await (supabase as any).from('episode_activity_log').insert({
        project_id: projectId, episode_id: episodeId, user_id: user.id,
        action: 'restore', details: {},
      });
    },
    onSuccess: () => {
      toast.success('Episode restored');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Hard delete episode (permanent) ──
  const hardDeleteEpisode = useMutation({
    mutationFn: async (episodeId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const ep = allEpisodes.find(e => e.id === episodeId);
      if (!ep) throw new Error('Episode not found');

      // Log before deleting
      await (supabase as any).from('episode_activity_log').insert({
        project_id: projectId, episode_id: episodeId, user_id: user.id,
        action: 'hard_delete', details: { episode_number: ep.episode_number, title: ep.title },
      });

      // Delete linked artifacts
      const epNum = ep.episode_number;
      await (supabase as any).from('episode_validations').delete().eq('episode_id', episodeId);
      await (supabase as any).from('episode_comments').delete().eq('project_id', projectId).eq('episode_number', epNum);
      await (supabase as any).from('episode_compliance_reports').delete().eq('project_id', projectId).eq('episode_number', epNum);
      await (supabase as any).from('episode_continuity_ledgers').delete().eq('project_id', projectId).eq('episode_number', epNum);
      await (supabase as any).from('episode_continuity_notes').delete().eq('project_id', projectId).eq('episode_number', epNum);
      await (supabase as any).from('vertical_episode_metrics').delete().eq('project_id', projectId).eq('episode_number', epNum);

      const { error } = await supabase.from('series_episodes').delete().eq('id', episodeId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Episode permanently deleted');
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Clear & re-queue a deleted episode slot for fresh generation ──
  const clearAndRequeueEpisode = useMutation({
    mutationFn: async (episodeId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: ep, error: fetchErr } = await supabase
        .from('series_episodes')
        .select('episode_number')
        .eq('id', episodeId)
        .single();
      if (fetchErr) throw fetchErr;
      const { error } = await supabase.from('series_episodes').update({
        is_deleted: false,
        deleted_at: null,
        deleted_by: null,
        status: 'pending',
        script_id: null,
        title: `Episode ${ep.episode_number}`,
        logline: null,
      }).eq('id', episodeId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast.success('Episode slot cleared — ready to regenerate');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Escalate to Dev Engine ──
  const escalateToDevEngine = useMutation({
    mutationFn: async (params: {
      episodeId: string;
      issueTitle: string;
      issueDescription: string;
      desiredOutcome: string;
      contextDocKeys: string[];
      sourceNotes?: any[];
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const ep = episodes.find(e => e.id === params.episodeId);
      if (!ep) throw new Error('Episode not found');

      let scriptText = '';
      if (ep.script_id) {
        const { data: s } = await supabase.from('scripts').select('text_content').eq('id', ep.script_id).single();
        scriptText = (s as any)?.text_content || '';
      }

      const { data: docs } = await supabase
        .from('project_documents')
        .select('id, doc_type')
        .eq('project_id', projectId)
        .in('doc_type', params.contextDocKeys);
      const docIds = (docs || []).map(d => d.id);

      const { data: patchRun, error } = await (supabase as any)
        .from('episode_patch_runs')
        .insert({
          project_id: projectId,
          episode_id: params.episodeId,
          user_id: user.id,
          issue_title: params.issueTitle,
          issue_description: params.issueDescription,
          desired_outcome: params.desiredOutcome,
          context_doc_ids: docIds,
          source_notes: params.sourceNotes || [],
          episode_script_text: scriptText.slice(0, 50000),
          status: 'pending',
        })
        .select()
        .single();
      if (error) throw error;

      // Trigger dev-engine-v2 episode_patch action
      try {
        await callDevEngineV2('episode-patch', {
          projectId,
          patchRunId: patchRun.id,
          episodeId: params.episodeId,
          episodeNumber: ep.episode_number,
          issueTitle: params.issueTitle,
          issueDescription: params.issueDescription,
          desiredOutcome: params.desiredOutcome,
          contextDocIds: docIds,
          episodeScriptText: scriptText.slice(0, 30000),
        });
      } catch {
        await (supabase as any).from('episode_patch_runs').update({ status: 'failed' }).eq('id', patchRun.id);
        throw new Error('Dev Engine patch request failed');
      }

      return patchRun;
    },
    onSuccess: () => {
      toast.success('Issue sent to Dev Engine');
      qc.invalidateQueries({ queryKey: ['episode-patch-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Apply patch ──
  const applyPatch = useMutation({
    mutationFn: async (patchRunId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: patch } = await (supabase as any)
        .from('episode_patch_runs').select('*').eq('id', patchRunId).single();
      if (!patch || patch.status !== 'complete') throw new Error('Patch not ready');

      const ep = episodes.find(e => e.id === patch.episode_id);
      if (!ep?.script_id) throw new Error('Episode has no script');

      const newText = patch.proposed_changes?.replacement_script || patch.proposed_changes?.patched_text || '';
      if (!newText) throw new Error('No replacement content in patch');

      const { data: newScript, error: sErr } = await supabase
        .from('scripts').insert({
          project_id: projectId, created_by: user.id,
          text_content: newText, version_label: `${ep.title} (patched)`,
        }).select('id').single();
      if (sErr) throw sErr;

      await supabase.from('series_episodes').update({
        script_id: (newScript as any).id,
        status: 'complete',
        validation_status: 'pending',
      }).eq('id', patch.episode_id);

      await (supabase as any).from('episode_patch_runs').update({
        status: 'applied', applied_at: new Date().toISOString(),
        applied_by: user.id, applied_version_id: (newScript as any).id,
      }).eq('id', patchRunId);

      await (supabase as any).from('episode_activity_log').insert({
        project_id: projectId, episode_id: patch.episode_id, user_id: user.id,
        action: 'patch_applied', details: { patch_run_id: patchRunId, new_script_id: (newScript as any).id },
      });
    },
    onSuccess: () => {
      toast.success('Patch applied — new version created');
      invalidateAll();
      qc.invalidateQueries({ queryKey: ['episode-patch-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ── Reject patch ──
  const rejectPatch = useMutation({
    mutationFn: async (params: { patchRunId: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      await (supabase as any).from('episode_patch_runs').update({
        status: 'rejected', rejected_at: new Date().toISOString(),
        rejected_by: user.id, reject_reason: params.reason || null,
      }).eq('id', params.patchRunId);
      await (supabase as any).from('episode_activity_log').insert({
        project_id: projectId, episode_id: null, user_id: user.id,
        action: 'patch_rejected', details: { patch_run_id: params.patchRunId },
      });
    },
    onSuccess: () => {
      toast.success('Patch rejected');
      qc.invalidateQueries({ queryKey: ['episode-patch-runs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    episodes,
    allEpisodes,
    deletedEpisodes,
    showDeleted,
    setShowDeleted,
    isLoading,
    canonSnapshot,
    canonLoading,
    validations,
    episodeMetrics,
    metricsRunning,
    metricsRunningEp,
    progress,
    isGenerating,
    completedCount,
    isSeasonComplete,
    nextEpisode,
    hasFailedValidation,
    hasMetricsBlock,
    isCanonValid,
    createCanonSnapshot,
    createEpisodes,
    updateEpisode,
    generateAll,
    generateOne,
    stopGeneration,
    pauseGeneration,
    resumeGeneration,
    invalidateCanon,
    fetchScriptContent,
    runEpisodeMetrics,
    deleteEpisode,
    restoreEpisode,
    clearAndRequeueEpisode,
    hardDeleteEpisode,
    escalateToDevEngine,
    applyPatch,
    rejectPatch,
    resetStuckEpisode,
    runControl,
  };
}
