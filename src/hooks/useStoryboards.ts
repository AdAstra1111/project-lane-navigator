/**
 * useStoryboards — Hook for storyboard boards CRUD, auto-create from shot list, upload, export.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import type { ShotListItem } from '@/hooks/useShotList';

export interface StoryboardBoard {
  id: string;
  project_id: string;
  shot_list_id: string;
  shot_list_item_id: string;
  scene_number: string;
  shot_number: number;
  panel_text: string;
  framing_notes: string | null;
  composition_notes: string | null;
  camera_notes: string | null;
  action_notes: string | null;
  aspect_ratio: string;
  image_asset_path: string | null;
  image_source: string | null;
  locked: boolean;
  created_at: string;
  updated_at: string;
}

export function useStoryboards(projectId: string | undefined, shotListId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['storyboard-boards', shotListId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('storyboard_boards')
        .select('*')
        .eq('shot_list_id', shotListId)
        .order('scene_number', { ascending: true })
        .order('shot_number', { ascending: true });
      if (error) throw error;
      return (data || []) as StoryboardBoard[];
    },
    enabled: !!shotListId,
  });

  // Auto-create boards from shot list items
  const autoCreate = useMutation({
    mutationFn: async (items: ShotListItem[]) => {
      if (!shotListId || !projectId) return;

      // Check existing
      const { data: existing } = await (supabase as any)
        .from('storyboard_boards')
        .select('shot_list_item_id')
        .eq('shot_list_id', shotListId);

      const existingIds = new Set((existing || []).map((e: any) => e.shot_list_item_id));
      const missing = items.filter(i => !existingIds.has(i.id));

      if (missing.length === 0) return { created: 0 };

      // Detect vertical drama
      const { data: project } = await supabase.from('projects').select('format').eq('id', projectId).single();
      const isVertical = project?.format?.toLowerCase().includes('vertical');
      const aspectRatio = isVertical ? '9:16' : '16:9';

      const rows = missing.map(item => ({
        project_id: projectId,
        shot_list_id: shotListId,
        shot_list_item_id: item.id,
        scene_number: item.scene_number,
        shot_number: item.shot_number,
        panel_text: `[${item.shot_type}] ${item.framing} — ${item.action}${item.camera_movement ? ` (${item.camera_movement})` : ''}`,
        framing_notes: item.framing || null,
        camera_notes: item.camera_movement || null,
        action_notes: item.action || null,
        aspect_ratio: aspectRatio,
        image_source: 'none',
      }));

      const { error } = await (supabase as any)
        .from('storyboard_boards')
        .insert(rows);
      if (error) throw error;
      return { created: rows.length };
    },
    onSuccess: (data) => {
      if (data?.created) {
        toast.success(`Created ${data.created} storyboard panels`);
      }
      qc.invalidateQueries({ queryKey: ['storyboard-boards', shotListId] });
    },
    onError: (err: any) => toast.error('Auto-create failed: ' + err.message),
  });

  // Update board
  const updateBoard = useMutation({
    mutationFn: async ({ boardId, updates }: { boardId: string; updates: Partial<StoryboardBoard> }) => {
      const { error } = await (supabase as any)
        .from('storyboard_boards')
        .update(updates)
        .eq('id', boardId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['storyboard-boards', shotListId] });
    },
  });

  // Upload image
  const uploadImage = useMutation({
    mutationFn: async ({ boardId, file }: { boardId: string; file: File }) => {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${projectId}/storyboards/${shotListId}/${boardId}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('projects')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      const { error: updateErr } = await (supabase as any)
        .from('storyboard_boards')
        .update({ image_asset_path: path, image_source: 'upload' })
        .eq('id', boardId);
      if (updateErr) throw updateErr;

      return path;
    },
    onSuccess: () => {
      toast.success('Image uploaded');
      qc.invalidateQueries({ queryKey: ['storyboard-boards', shotListId] });
    },
    onError: (err: any) => toast.error('Upload failed: ' + err.message),
  });

  // Toggle lock
  const toggleLock = useMutation({
    mutationFn: async ({ boardIds, locked }: { boardIds: string[]; locked: boolean }) => {
      const { error } = await (supabase as any)
        .from('storyboard_boards')
        .update({ locked })
        .in('id', boardIds);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['storyboard-boards', shotListId] });
    },
  });

  // Get signed URL for image
  const getImageUrl = async (path: string) => {
    const { data } = await supabase.storage
      .from('projects')
      .createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  };

  return {
    boards,
    isLoading,
    autoCreate,
    updateBoard,
    uploadImage,
    toggleLock,
    getImageUrl,
  };
}
