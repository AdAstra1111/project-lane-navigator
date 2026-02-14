import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState, useRef, useCallback } from 'react';

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
  created_at: string;
  updated_at: string;
}

type GenerationPhase = 'blueprint' | 'architecture' | 'draft' | 'score';
const PHASES: GenerationPhase[] = ['blueprint', 'architecture', 'draft', 'score'];

export interface SeriesProgress {
  currentEpisode: number;
  totalEpisodes: number;
  phase: GenerationPhase | 'idle' | 'complete' | 'error';
  error?: string;
}

export function useSeriesWriter(projectId: string) {
  const qc = useQueryClient();
  const [progress, setProgress] = useState<SeriesProgress>({
    currentEpisode: 0, totalEpisodes: 0, phase: 'idle',
  });
  const runningRef = useRef(false);

  const queryKey = ['series-episodes', projectId];

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

  function invalidate() {
    qc.invalidateQueries({ queryKey });
  }

  // Create episode slots
  const createEpisodes = useMutation({
    mutationFn: async (count: number) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Delete existing episodes first
      await supabase.from('series_episodes').delete().eq('project_id', projectId);

      const rows = Array.from({ length: count }, (_, i) => ({
        project_id: projectId,
        user_id: user.id,
        episode_number: i + 1,
        title: `Episode ${i + 1}`,
        status: 'pending',
      }));

      const { error } = await supabase.from('series_episodes').insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Episode slots created');
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Update a single episode
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
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  // Call script-engine for a specific action (with optional episode context)
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

  // Update episode progress in DB
  async function updateEpisodeProgress(episodeId: string, phase: string, status: string, scriptId?: string) {
    const updates: Record<string, any> = {
      generation_progress: { phase, updatedAt: new Date().toISOString() },
      status,
    };
    if (scriptId) updates.script_id = scriptId;
    await supabase.from('series_episodes').update(updates).eq('id', episodeId);
  }

  // Generate a single episode through the full pipeline
  const generateOne = useCallback(async (episode: SeriesEpisode) => {
    if (runningRef.current) {
      toast.warning('Generation already in progress');
      return;
    }
    runningRef.current = true;
    setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'blueprint' });

    try {
      const episodeContext = {
        episodeNumber: episode.episode_number,
        episodeTitle: episode.title,
        episodeLogline: episode.logline,
        totalEpisodes: 1,
        seriesMode: true,
      };

      await updateEpisodeProgress(episode.id, 'blueprint', 'generating');
      const bpResult = await callEngine('blueprint', projectId, undefined, { forceNew: true, ...episodeContext });
      const scriptId = bpResult.scriptId;
      if (!scriptId) throw new Error('Blueprint did not return scriptId');
      await updateEpisodeProgress(episode.id, 'blueprint', 'generating', scriptId);

      // Extract title/logline from blueprint and update episode
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

      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'draft' });
      await updateEpisodeProgress(episode.id, 'draft', 'generating');
      await callEngine('draft', projectId, scriptId, episodeContext);

      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'score' });
      await updateEpisodeProgress(episode.id, 'score', 'generating');
      await callEngine('score', projectId, scriptId, episodeContext);

      await updateEpisodeProgress(episode.id, 'complete', 'complete');
      toast.success(`Episode ${episode.episode_number} generated`);
    } catch (err: any) {
      console.error(`Episode ${episode.episode_number} generation failed:`, err);
      await updateEpisodeProgress(episode.id, 'error', 'error');
      setProgress({ currentEpisode: episode.episode_number, totalEpisodes: 1, phase: 'error', error: err.message });
      toast.error(`Episode ${episode.episode_number} failed: ${err.message}`);
    }

    setProgress(prev => ({ ...prev, phase: 'complete' }));
    invalidate();
    runningRef.current = false;
  }, [projectId]);

  // Generate all episodes sequentially
  const generateAll = useCallback(async () => {
    if (runningRef.current) {
      toast.warning('Generation already in progress');
      return;
    }
    runningRef.current = true;

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
      const ep = freshEpisodes[i] as SeriesEpisode;
      if (ep.status === 'complete') continue;

      const episodeContext = {
        episodeNumber: ep.episode_number,
        episodeTitle: ep.title,
        episodeLogline: ep.logline,
        totalEpisodes: total,
        seriesMode: true,
      };

      setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'blueprint' });

      try {
        await updateEpisodeProgress(ep.id, 'blueprint', 'generating');
        const bpResult = await callEngine('blueprint', projectId, undefined, { forceNew: true, ...episodeContext });
        const scriptId = bpResult.scriptId;
        if (!scriptId) throw new Error('Blueprint did not return scriptId');
        await updateEpisodeProgress(ep.id, 'blueprint', 'generating', scriptId);

        // Extract title/logline from blueprint and update episode
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

        await updateEpisodeProgress(ep.id, 'complete', 'complete');
        invalidate();
      } catch (err: any) {
        console.error(`Episode ${ep.episode_number} generation failed:`, err);
        await updateEpisodeProgress(ep.id, 'error', 'error');
        setProgress({ currentEpisode: ep.episode_number, totalEpisodes: total, phase: 'error', error: err.message });
        toast.error(`Episode ${ep.episode_number} failed: ${err.message}`);
      }
    }

    setProgress(prev => ({ ...prev, phase: 'complete' }));
    toast.success('Series generation complete');
    invalidate();
    runningRef.current = false;
  }, [projectId]);

  // Fetch script content for reading
  const fetchScriptContent = useCallback(async (scriptId: string): Promise<string> => {
    const { data, error } = await supabase
      .from('scripts')
      .select('text_content')
      .eq('id', scriptId)
      .single();
    if (error) throw error;
    return data?.text_content || 'No content available.';
  }, []);

  const isGenerating = runningRef.current;

  return {
    episodes,
    isLoading,
    progress,
    isGenerating,
    createEpisodes,
    updateEpisode,
    generateAll,
    generateOne,
    fetchScriptContent,
  };
}
