/**
 * useAiTrailerFactory — Hook for AI Trailer Factory MVP.
 * Points to the ai-trailer-factory edge function with all 8 actions.
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
    mutationFn: (params: { documentId: string; versionId: string }) =>
      callFactory('extract_trailer_moments', { projectId, ...params }),
    onSuccess: (data) => { toast.success(`Extracted ${data.inserted} trailer moments`); qc.invalidateQueries({ queryKey: ['trailer-moments', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const buildShotlist = useMutation({
    mutationFn: (params?: { count?: number }) =>
      callFactory('build_trailer_shotlist', { projectId, ...params }),
    onSuccess: () => { toast.success('Trailer shotlist built'); qc.invalidateQueries({ queryKey: ['trailer-shotlists', projectId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const generateTrailerAssets = useMutation({
    mutationFn: (trailerShotlistId: string) =>
      callFactory('generate_trailer_assets', { projectId, trailerShotlistId }),
    onSuccess: (data) => {
      toast.success(`Generated ${data.framesGenerated} frames, ${data.motionStillsGenerated} motion stills`);
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
    isLoadingMedia: mediaQuery.isLoading,
    isLoadingMoments: momentsQuery.isLoading,
    isLoadingShotlists: shotlistsQuery.isLoading,
    labelReadiness, generateFrames, selectMedia, generateMotionStill,
    extractMoments, buildShotlist, generateTrailerAssets, assembleTrailer,
  };
}
