/**
 * useShotList — Hook for managing shot lists: CRUD, generate, regen, lock, export.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ShotList {
  id: string;
  project_id: string;
  name: string;
  source_document_id: string;
  source_version_id: string;
  episode_number: number | null;
  scope: any;
  status: string;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface ShotListItem {
  id: string;
  shot_list_id: string;
  project_id: string;
  scene_number: string;
  scene_heading: string;
  shot_number: number;
  shot_type: string;
  framing: string;
  action: string;
  camera_movement: string;
  duration_est_seconds: number | null;
  location: string | null;
  time_of_day: string | null;
  characters_present: string[] | null;
  props_or_set_notes: string | null;
  vfx_sfx_flags: any;
  audio_notes: string | null;
  continuity_notes: string | null;
  locked: boolean;
  order_index: number;
  anchor_ref: any;
  created_at: string;
  updated_at: string;
}

export function useShotList(projectId: string | undefined, shotListId?: string) {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Fetch all shot lists for project
  const { data: shotLists = [], isLoading: listsLoading } = useQuery({
    queryKey: ['shot-lists', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('shot_lists')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ShotList[];
    },
    enabled: !!projectId,
  });

  // Fetch items for a specific shot list
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['shot-list-items', shotListId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('shot_list_items')
        .select('*')
        .eq('shot_list_id', shotListId)
        .order('order_index', { ascending: true });
      if (error) throw error;
      return (data || []) as ShotListItem[];
    },
    enabled: !!shotListId,
  });

  // Generate shot list
  const generate = useMutation({
    mutationFn: async (input: {
      sourceDocumentId: string;
      sourceVersionId: string;
      episodeNumber?: number;
      scope?: any;
      name?: string;
      isVerticalDrama?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('generate-shot-list', {
        body: {
          action: 'generate',
          projectId,
          sourceDocumentId: input.sourceDocumentId,
          sourceVersionId: input.sourceVersionId,
          episodeNumber: input.episodeNumber,
          scope: input.scope || { mode: 'full' },
          name: input.name,
          userId: user?.id,
          isVerticalDrama: input.isVerticalDrama,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Shot list generated: ${data.count} shots across ${data.scenes_parsed} scenes`);
      qc.invalidateQueries({ queryKey: ['shot-lists', projectId] });
    },
    onError: (err: any) => toast.error('Generation failed: ' + err.message),
  });

  // Regenerate shots
  const regenerate = useMutation({
    mutationFn: async (input: {
      shotListId: string;
      scope?: { scene_numbers?: string[]; shot_ids?: string[] };
      isVerticalDrama?: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('generate-shot-list', {
        body: {
          action: 'regenerate',
          shotListId: input.shotListId,
          scope: input.scope,
          userId: user?.id,
          isVerticalDrama: input.isVerticalDrama,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Regenerated ${data.regenerated} shots (${data.locked_preserved} locked preserved)`);
      qc.invalidateQueries({ queryKey: ['shot-list-items'] });
      qc.invalidateQueries({ queryKey: ['shot-lists', projectId] });
    },
    onError: (err: any) => toast.error('Regen failed: ' + err.message),
  });

  // Toggle lock on items
  const toggleLock = useMutation({
    mutationFn: async ({ itemIds, locked }: { itemIds: string[]; locked: boolean }) => {
      const { error } = await (supabase as any)
        .from('shot_list_items')
        .update({ locked })
        .in('id', itemIds);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shot-list-items', shotListId] });
    },
  });

  // Update single item inline
  const updateItem = useMutation({
    mutationFn: async ({ itemId, updates }: { itemId: string; updates: Partial<ShotListItem> }) => {
      const { error } = await (supabase as any)
        .from('shot_list_items')
        .update(updates)
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shot-list-items', shotListId] });
    },
  });

  // Delete shot list
  const deleteShotList = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('shot_lists')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shot-lists', projectId] });
      toast.success('Shot list deleted');
    },
  });

  return {
    shotLists,
    items,
    listsLoading,
    itemsLoading,
    generate,
    regenerate,
    toggleLock,
    updateItem,
    deleteShotList,
  };
}
