/**
 * useAiProduction — Hook for AI Production Layer features.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

async function callAiProductionLayer(action: string, payload: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-production-layer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'AI Production error';
    try { msg = JSON.parse(text).error || msg; } catch {}
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

export function useAiProduction(projectId: string | undefined) {
  const qc = useQueryClient();

  // AI generated media for project
  const mediaQuery = useQuery({
    queryKey: ['ai-media', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ai_generated_media')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as AiGeneratedMedia[];
    },
    enabled: !!projectId,
  });

  // Trailer moments
  const momentsQuery = useQuery({
    queryKey: ['trailer-moments', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('trailer_moments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as TrailerMoment[];
    },
    enabled: !!projectId,
  });

  // Trailer shotlists
  const shotlistsQuery = useQuery({
    queryKey: ['trailer-shotlists', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('trailer_shotlists')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as TrailerShotlist[];
    },
    enabled: !!projectId,
  });

  // Label AI readiness
  const labelReadiness = useMutation({
    mutationFn: (shotId: string) =>
      callAiProductionLayer('label_ai_readiness', { projectId, shotId }),
    onSuccess: () => {
      toast.success('AI readiness labeled');
      qc.invalidateQueries({ queryKey: ['vp-shots', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Generate shot media
  const generateMedia = useMutation({
    mutationFn: (params: {
      shotId: string;
      generationType: 'storyboard_frame' | 'animated_panel';
      options?: { aspectRatio?: string; style?: string; variations?: number };
    }) => callAiProductionLayer('generate_shot_media', { projectId, ...params }),
    onSuccess: (data) => {
      toast.success(`Generated ${data.count} frame(s)`);
      qc.invalidateQueries({ queryKey: ['ai-media', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Extract trailer moments
  const extractMoments = useMutation({
    mutationFn: (params: { documentId: string; versionId: string }) =>
      callAiProductionLayer('extract_trailer_moments', { projectId, ...params }),
    onSuccess: (data) => {
      toast.success(`Extracted ${data.inserted} trailer moments`);
      qc.invalidateQueries({ queryKey: ['trailer-moments', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Build trailer shotlist
  const buildShotlist = useMutation({
    mutationFn: (params?: { count?: number }) =>
      callAiProductionLayer('build_trailer_shotlist', { projectId, ...params }),
    onSuccess: () => {
      toast.success('Trailer shotlist built');
      qc.invalidateQueries({ queryKey: ['trailer-shotlists', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Assemble taster trailer
  const assembleTrailer = useMutation({
    mutationFn: (params: { trailerShotlistId: string; selectedShotIds?: string[] }) =>
      callAiProductionLayer('assemble_taster_trailer', { projectId, ...params }),
    onSuccess: () => {
      toast.success('Taster trailer assembled');
      qc.invalidateQueries({ queryKey: ['ai-media', projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Select/deselect media
  const toggleMediaSelect = useMutation({
    mutationFn: async ({ mediaId, selected }: { mediaId: string; selected: boolean }) => {
      const { error } = await (supabase as any)
        .from('ai_generated_media')
        .update({ selected })
        .eq('id', mediaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-media', projectId] }),
  });

  return {
    media: mediaQuery.data || [],
    moments: momentsQuery.data || [],
    shotlists: shotlistsQuery.data || [],
    isLoadingMedia: mediaQuery.isLoading,
    isLoadingMoments: momentsQuery.isLoading,
    isLoadingShotlists: shotlistsQuery.isLoading,
    labelReadiness,
    generateMedia,
    extractMoments,
    buildShotlist,
    assembleTrailer,
    toggleMediaSelect,
  };
}
