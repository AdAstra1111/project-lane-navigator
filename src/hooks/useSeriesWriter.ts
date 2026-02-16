import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useRef, useCallback } from 'react';
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

type GenerationPhase = 'blueprint' | 'architecture' | 'draft' | 'score' | 'validate' | 'metrics';
const PHASES: GenerationPhase[] = ['blueprint', 'architecture', 'draft', 'score', 'validate', 'metrics'];

export interface SeriesProgress {
  currentEpisode: number;
  totalEpisodes: number;
  phase: GenerationPhase | 'idle' | 'complete' | 'error';
  error?: string;
}

export type { VerticalEpisodeMetricRow, EpisodeMetrics };

export function useSeriesWriter(projectId: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<SeriesProgress>({
    currentEpisode: 0, totalEpisodes: 0, phase: 'idle',
  });
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const [, forceRender] = useState(0);

  const [metricsRunning, setMetricsRunning] = useState(false);
  const [metricsRunningEp, setMetricsRunningEp] = useState<number | null>(null);

  const queryKey = ['series-episodes', projectId];
  const canonKey = ['canon-snapshot', projectId];
  const validationKey = ['episode-validations', projectId];
  const metricsKey = ['vertical-episode-metrics', projectId];

  // ── Episodes ──
  const { data: episodes = [], isLoading } = useQuery({
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

  // ── Update episode progress ──
  async function updateEpisodeProgress(episodeId: string, phase: string, status: string, scriptId?: string) {
    const updates: Record<string, any> = {
      generation_progress: { phase, updatedAt: new Date().toISOString() },
      status,
    };
    if (scriptId) updates.script_id = scriptId;
    if (canonSnapshot?.id) updates.canon_snapshot_id = canonSnapshot.id;
    await supabase.from('series_episodes').update(updates).eq('id', episodeId);
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

  // ── Generate a single episode ──
  const generateOne = useCallback(async (episode: SeriesEpisode) => {
    if (runningRef.current) {
      toast.warning('Generation already in progress');
      return;
    }
    runningRef.current = true;
    stopRequestedRef.current = false;
    forceRender(n => n + 1);
    setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'blueprint' });

    try {
      // Fetch previous episode's script for continuity
      let previousEpisodeSummary: string | undefined;
      if (episode.episode_number > 1) {
        const { data: prevEps } = await supabase
          .from('series_episodes')
          .select('script_id, title, logline')
          .eq('project_id', projectId)
          .eq('episode_number', episode.episode_number - 1)
          .eq('status', 'complete')
          .single();
        if (prevEps?.script_id) {
          const { data: prevScript } = await supabase
            .from('scripts')
            .select('text_content')
            .eq('id', prevEps.script_id)
            .single();
          const prevText = prevScript?.text_content?.slice(0, 3000) || '';
          previousEpisodeSummary = `Previous Episode "${prevEps.title}" (${prevEps.logline || 'no logline'}):\n${prevText}`;
        }
      }

      // Fetch canon context (episode grid row, blueprint, character bible)
      let canonContext = '';
      if (canonSnapshot) {
        // Fetch episode grid text for this episode's row
        if (canonSnapshot.episode_grid_version_id) {
          const { data: gridVer } = await supabase
            .from('project_document_versions')
            .select('plaintext')
            .eq('id', canonSnapshot.episode_grid_version_id)
            .single();
          if (gridVer?.plaintext) {
            canonContext += `\n\nEPISODE GRID (Canon Locked):\n${(gridVer.plaintext as string).slice(0, 4000)}`;
          }
        }
        // Fetch character bible
        if (canonSnapshot.character_bible_version_id) {
          const { data: cbVer } = await supabase
            .from('project_document_versions')
            .select('plaintext')
            .eq('id', canonSnapshot.character_bible_version_id)
            .single();
          if (cbVer?.plaintext) {
            canonContext += `\n\nCHARACTER BIBLE (Canon Locked):\n${(cbVer.plaintext as string).slice(0, 3000)}`;
          }
        }
        // Fetch blueprint/season arc
        if (canonSnapshot.blueprint_version_id) {
          const { data: bpVer } = await supabase
            .from('project_document_versions')
            .select('plaintext')
            .eq('id', canonSnapshot.blueprint_version_id)
            .single();
          if (bpVer?.plaintext) {
            canonContext += `\n\nSEASON BLUEPRINT (Canon Locked):\n${(bpVer.plaintext as string).slice(0, 3000)}`;
          }
        }
      }

      const episodeContext = {
        episodeNumber: episode.episode_number,
        episodeTitle: episode.title,
        episodeLogline: episode.logline,
        totalEpisodes: canonSnapshot?.season_episode_count || 1,
        seriesMode: true,
        previousEpisodeSummary,
        canonContext,
        canonSnapshotId: canonSnapshot?.id,
      };

      await updateEpisodeProgress(episode.id, 'blueprint', 'generating');
      const bpResult = await callEngine('blueprint', projectId, undefined, { forceNew: true, ...episodeContext });
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');
      const scriptId = bpResult.scriptId;
      if (!scriptId) throw new Error('Blueprint did not return scriptId');
      await updateEpisodeProgress(episode.id, 'blueprint', 'generating', scriptId);

      // Extract title/logline from blueprint
      const bp = bpResult.blueprint || {};
      const extractedTitle = bp.title || bp.episode_title || 
        bp.three_act_breakdown?.act_1?.name ||
        bp.hook_cadence?.[0]?.episode_title || 
        bp.season_arc?.episode_title;
      const extractedLogline = bp.resolution?.description ||
        bp.thematic_spine?.theme ||
        (typeof bp.thematic_spine === 'string' ? bp.thematic_spine : null) ||
        bp.season_arc?.compressed_arc || 
        bp.retention_mechanics;
      if (extractedTitle || extractedLogline) {
        const updates: Record<string, any> = {};
        if (extractedTitle && typeof extractedTitle === 'string') updates.title = extractedTitle.substring(0, 100);
        if (extractedLogline && typeof extractedLogline === 'string') updates.logline = extractedLogline.substring(0, 300);
        if (Object.keys(updates).length > 0) {
          await supabase.from('series_episodes').update(updates).eq('id', episode.id);
        }
      }

      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'architecture' });
      await updateEpisodeProgress(episode.id, 'architecture', 'generating');
      await callEngine('architecture', projectId, scriptId, episodeContext);
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'draft' });
      await updateEpisodeProgress(episode.id, 'draft', 'generating');
      await callEngine('draft', projectId, scriptId, episodeContext);
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'score' });
      await updateEpisodeProgress(episode.id, 'score', 'generating');
      await callEngine('score', projectId, scriptId, episodeContext);
      if (stopRequestedRef.current) throw new Error('Generation stopped by user');

      // Validate
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'validate' });
      const passed = await validateEpisode(episode, scriptId);

      // Run metrics scoring
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'metrics' });
      await runEpisodeMetrics(episode.episode_number, scriptId);

      await updateEpisodeProgress(episode.id, 'complete', passed ? 'complete' : 'needs_revision');
      toast.success(`Episode ${episode.episode_number} generated${!passed ? ' (needs revision)' : ''}`);
    } catch (err: any) {
      const stopped = stopRequestedRef.current;
      console.error(`Episode ${episode.episode_number} generation ${stopped ? 'stopped' : 'failed'}:`, err);
      await updateEpisodeProgress(episode.id, 'error', stopped ? 'pending' : 'error');
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: stopped ? 'idle' : 'error', error: stopped ? undefined : err.message });
      if (stopped) toast.info('Generation stopped');
      else toast.error(`Episode ${episode.episode_number} failed: ${err.message}`);
    }

    setProgress(prev => ({ ...prev, phase: stopRequestedRef.current ? 'idle' : 'complete' }));
    invalidateAll();
    runningRef.current = false;
    stopRequestedRef.current = false;
    forceRender(n => n + 1);
  }, [projectId, canonSnapshot]);

  // ── Generate all pending episodes sequentially ──
  const generateAll = useCallback(async () => {
    if (runningRef.current) {
      toast.warning('Generation already in progress');
      return;
    }
    runningRef.current = true;
    stopRequestedRef.current = false;
    forceRender(n => n + 1);

    const { data: freshEpisodes, error: fetchErr } = await supabase
      .from('series_episodes')
      .select('*')
      .eq('project_id', projectId)
      .order('episode_number', { ascending: true });

    if (fetchErr || !freshEpisodes?.length) {
      toast.error('No episodes to generate');
      runningRef.current = false;
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
      if (ep.status === 'complete') continue;
      // Block if previous episode failed validation
      if (i > 0 && freshEpisodes[i - 1].validation_status === 'needs_revision') {
        toast.warning(`Episode ${freshEpisodes[i - 1].episode_number} needs revision before continuing`);
        break;
      }

      const episodeContext = {
        episodeNumber: ep.episode_number,
        episodeTitle: ep.title,
        episodeLogline: ep.logline,
        totalEpisodes: total,
        seriesMode: true,
        canonSnapshotId: canonSnapshot?.id,
      };

      setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'blueprint' });

      try {
        await updateEpisodeProgress(ep.id, 'blueprint', 'generating');
        const bpResult = await callEngine('blueprint', projectId, undefined, { forceNew: true, ...episodeContext });
        const scriptId = bpResult.scriptId;
        if (!scriptId) throw new Error('Blueprint did not return scriptId');
        await updateEpisodeProgress(ep.id, 'blueprint', 'generating', scriptId);

        // Extract title/logline
        const bp = bpResult.blueprint || {};
        const extractedTitle = bp.title || bp.episode_title || 
          bp.three_act_breakdown?.act_1?.name ||
          bp.hook_cadence?.[0]?.episode_title || 
          bp.season_arc?.episode_title;
        const extractedLogline = bp.resolution?.description ||
          bp.thematic_spine?.theme ||
          (typeof bp.thematic_spine === 'string' ? bp.thematic_spine : null) ||
          bp.season_arc?.compressed_arc || 
          bp.retention_mechanics;
        if (extractedTitle || extractedLogline) {
          const updates: Record<string, any> = {};
          if (extractedTitle && typeof extractedTitle === 'string') updates.title = extractedTitle.substring(0, 100);
          if (extractedLogline && typeof extractedLogline === 'string') updates.logline = extractedLogline.substring(0, 300);
          if (Object.keys(updates).length > 0) {
            await supabase.from('series_episodes').update(updates).eq('id', ep.id);
          }
        }

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'architecture' });
        await updateEpisodeProgress(ep.id, 'architecture', 'generating');
        await callEngine('architecture', projectId, scriptId, episodeContext);

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'draft' });
        await updateEpisodeProgress(ep.id, 'draft', 'generating');
        await callEngine('draft', projectId, scriptId, episodeContext);

        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'score' });
        await updateEpisodeProgress(ep.id, 'score', 'generating');
        await callEngine('score', projectId, scriptId, episodeContext);

        // Validate
        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'validate' });
        const passed = await validateEpisode(ep as SeriesEpisode, scriptId);

        await updateEpisodeProgress(ep.id, 'complete', passed ? 'complete' : 'needs_revision');
        invalidateAll();

        if (!passed) {
          toast.warning(`Episode ${ep.episode_number} needs revision — stopping auto-run`);
          break;
        }
      } catch (err: any) {
        console.error(`Episode ${ep.episode_number} generation failed:`, err);
        await updateEpisodeProgress(ep.id, 'error', 'error');
        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'error', error: err.message });
        toast.error(`Episode ${ep.episode_number} failed: ${err.message}`);
        break; // Stop on error
      }
    }

    // Check completion
    const { data: finalEps } = await supabase
      .from('series_episodes')
      .select('status')
      .eq('project_id', projectId);
    const allDone = finalEps?.every(e => e.status === 'complete');
    if (allDone) {
      toast.success('Season generation complete!');
    }

    setProgress(prev => ({ ...prev, phase: stopRequestedRef.current ? 'idle' : 'complete' }));
    invalidateAll();
    runningRef.current = false;
    stopRequestedRef.current = false;
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
    toast.info('Stopping after current phase completes…');
  }, []);

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

  return {
    episodes,
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
    invalidateCanon,
    fetchScriptContent,
    runEpisodeMetrics,
  };
}
