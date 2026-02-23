/**
 * useAiTrailerFactory — Hook for AI Trailer Factory MVP.
 * Points to the ai-trailer-factory edge function with all actions.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

async function callFactory(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-trailer-factory`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'AI Trailer Factory error';
    try { msg = JSON.parse(text).error || msg; } catch {}
    if (resp.status === 429) msg = 'Rate limit exceeded. Try again shortly.';
    if (resp.status === 402) msg = 'AI credits exhausted. Add funds in Settings.';
    throw new Error(msg);
  }
  return resp.json();
}

export interface AiGeneratedMedia {
  id: string;
  project_id: string;
  shot_id: string | null;
  media_type: string;
  storage_path: string;
  generation_params: Record<string, any>;
  selected: boolean;
  created_by: string | null;
  created_at: string;
  trailer_shotlist_id: string | null;
  public_url?: string;
}

export interface TrailerMoment {
  id: string;
  project_id: string;
  source_document_id: string | null;
  source_version_id: string | null;
  scene_number: number | null;
  moment_summary: string;
  hook_strength: number;
  spectacle_score: number;
  emotional_score: number;
  ai_friendly: boolean;
  suggested_visual_approach: string | null;
  created_at: string;
}

export interface TrailerShotlist {
  id: string;
  project_id: string;
  items: any[];
  source_moment_ids: string[];
  status: string;
  created_by: string | null;
  created_at: string;
}

export interface TrailerDefinitionPack {
  id: string;
  project_id: string;
  title: string;
  status: string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrailerDefinitionPackItem {
  id: string;
  pack_id: string;
  project_id: string;
  document_id: string;
  version_id: string | null;
  role: string;
  sort_order: number;
  include: boolean;
  notes: string | null;
  created_at: string;
}

export function useAiTrailerFactory(projectId: string | undefined) {
  const qc = useQueryClient();

  const mediaQuery = useQuery({
    queryKey: ['ai-media', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ai_generated_media').select('*')
        .eq('project_id', projectId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as AiGeneratedMedia[];
    },
    enabled: !!projectId,
  });

  const momentsQuery = useQuery({
    queryKey: ['trailer-moments', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('trailer_moments').select('*')
        .eq('project_id', projectId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as TrailerMoment[];
    },
    enabled: !!projectId,
  });

  const shotlistsQuery = useQuery({
    queryKey: ['trailer-shotlists', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('trailer_shotlists').select('*')
        .eq('project_id', projectId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as TrailerShotlist[];
    },
    enabled: !!projectId,
  });

  // ─── Pack queries ───
  const packsQuery = useQuery({
    queryKey: ['trailer-packs', projectId],
    queryFn: async () => {
      const res = await callFactory('get_trailer_packs', { projectId });
      return (res.packs || []) as (TrailerDefinitionPack & { trailer_definition_pack_items: TrailerDefinitionPackItem[] })[];
    },
    enabled: !!projectId,
  });

  const upsertPack = useMutation({
    mutationFn: (params: {
      packId?: string;
      title?: string;
      items: Array<{ documentId: string; versionId?: string; role: string; sortOrder: number; include: boolean }>;
    }) => callFactory('upsert_trailer_pack', { projectId, ...params }),
    onSuccess: () => {
      toast.success('Trailer definition pack saved');
      qc.invalidateQueries({ queryKey: ['trailer-packs', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // ─── Existing mutations ───
  const labelReadiness = useMutation({
    mutationFn: (shotId: string) => callFactory('label_ai_readiness', { projectId, shotId }),
    onSuccess: () => { toast.success('AI readiness labeled'); qc.invalidateQueries({ queryKey: ['vp-shots', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateFrames = useMutation({
    mutationFn: (params: { shotId: string; options?: { aspectRatio?: string; style?: string; variations?: number } }) =>
      callFactory('generate_storyboard_frames', { projectId, ...params }),
    onSuccess: (data) => { toast.success(`Generated ${data.count} frame(s)`); qc.invalidateQueries({ queryKey: ['ai-media', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectMedia = useMutation({
    mutationFn: (mediaId: string) => callFactory('select_media', { projectId, mediaId }),
    onSuccess: () => { toast.success('Media selected'); qc.invalidateQueries({ queryKey: ['ai-media', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateMotionStill = useMutation({
    mutationFn: (params: { shotId: string; options?: { motion?: string } }) =>
      callFactory('animate_shot_clip', { projectId, ...params }),
    onSuccess: () => { toast.success('Motion still generated'); qc.invalidateQueries({ queryKey: ['ai-media', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const extractMoments = useMutation({
    mutationFn: (params: { packId?: string; documentId?: string; versionId?: string }) =>
      callFactory('extract_trailer_moments', { projectId, ...params }),
    onSuccess: (data) => { toast.success(`Extracted ${data.inserted} trailer moments`); qc.invalidateQueries({ queryKey: ['trailer-moments', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const buildShotlist = useMutation({
    mutationFn: (params?: { count?: number; momentIds?: string[] }) =>
      callFactory('build_trailer_shotlist', { projectId, ...params }),
    onSuccess: () => { toast.success('Trailer shotlist built'); qc.invalidateQueries({ queryKey: ['trailer-shotlists', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const createTrailerSourceScript = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pdf-to-script`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ projectId }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        let msg = 'PDF extraction failed';
        try { msg = JSON.parse(text).error || msg; } catch {}
        throw new Error(msg);
      }
      return resp.json();
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Trailer source script created');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveSelectedIndices = useMutation({
    mutationFn: async ({ shotlistId, selectedIndices }: { shotlistId: string; selectedIndices: number[] }) => {
      const { error } = await (supabase as any)
        .from('trailer_shotlists')
        .update({ selected_indices: selectedIndices })
        .eq('id', shotlistId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trailer-shotlists', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateShotlistItems = useMutation({
    mutationFn: async ({ shotlistId, items }: { shotlistId: string; items: any[] }) => {
      const { error } = await (supabase as any)
        .from('trailer_shotlists')
        .update({ items })
        .eq('id', shotlistId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['trailer-shotlists', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateTrailerAssets = useMutation({
    mutationFn: async (trailerShotlistId: string) => {
      // Step 1: Get the plan (list of beats to process)
      const plan = await callFactory('generate_trailer_assets', { projectId, trailerShotlistId });
      if (plan.mode !== 'plan' || !plan.beats?.length) return plan;

      // Step 2: Process each beat one at a time
      let framesGenerated = 0;
      let motionStillsGenerated = 0;
      const results: any[] = [];
      const motionStillBudget = 8;

      for (const beat of plan.beats) {
        try {
          const res = await callFactory('generate_trailer_assets', {
            projectId, trailerShotlistId,
            beatIndex: beat.index,
            skipMotionStill: motionStillsGenerated >= motionStillBudget,
          });
          framesGenerated += res.framesGenerated || 0;
          motionStillsGenerated += res.motionStillsGenerated || 0;
          results.push(res);
        } catch (err) {
          console.error(`Beat ${beat.index} failed:`, err);
          results.push({ index: beat.index, status: 'error' });
        }
      }

      return { framesGenerated, motionStillsGenerated, results, total: plan.total };
    },
    onSuccess: (data) => {
      if (data?.framesGenerated !== undefined) {
        toast.success(`Generated ${data.framesGenerated} frames, ${data.motionStillsGenerated} motion stills`);
      }
      qc.invalidateQueries({ queryKey: ['ai-media', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const assembleTrailer = useMutation({
    mutationFn: (trailerShotlistId: string) =>
      callFactory('assemble_taster_trailer', { projectId, trailerShotlistId }),
    onSuccess: () => { toast.success('Taster trailer assembled'); qc.invalidateQueries({ queryKey: ['ai-media', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    media: mediaQuery.data || [],
    moments: momentsQuery.data || [],
    shotlists: shotlistsQuery.data || [],
    packs: packsQuery.data || [],
    isLoadingMedia: mediaQuery.isLoading,
    isLoadingMoments: momentsQuery.isLoading,
    isLoadingShotlists: shotlistsQuery.isLoading,
    isLoadingPacks: packsQuery.isLoading,
    labelReadiness, generateFrames, selectMedia, generateMotionStill,
    extractMoments, buildShotlist, createTrailerSourceScript, saveSelectedIndices,
    updateShotlistItems, generateTrailerAssets, assembleTrailer,
    upsertPack,
  };
}
