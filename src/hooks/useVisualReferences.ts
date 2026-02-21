/**
 * useVisualReferences — Hook for managing character/location/style reference packs.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface VisualReferenceSet {
  id: string;
  project_id: string;
  ref_type: string;
  name: string;
  description: string | null;
  data: any;
  is_default: boolean;
  locked: boolean;
  created_at: string;
  created_by: string;
  updated_at: string;
}

export interface VisualReferenceAsset {
  id: string;
  project_id: string;
  reference_set_id: string;
  storage_path: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  created_at: string;
  created_by: string;
}

export function useVisualReferences(projectId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: refSets = [], isLoading: setsLoading } = useQuery({
    queryKey: ['visual-ref-sets', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('visual_reference_sets')
        .select('*')
        .eq('project_id', projectId)
        .order('ref_type', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      return (data || []) as VisualReferenceSet[];
    },
    enabled: !!projectId,
  });

  const { data: refAssets = [], isLoading: assetsLoading } = useQuery({
    queryKey: ['visual-ref-assets', projectId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('visual_reference_assets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as VisualReferenceAsset[];
    },
    enabled: !!projectId,
  });

  const characters = refSets.filter(r => r.ref_type === 'character');
  const locations = refSets.filter(r => r.ref_type === 'location');
  const styles = refSets.filter(r => r.ref_type === 'style');
  const defaultStyle = styles.find(s => s.is_default) || null;

  const createRefSet = useMutation({
    mutationFn: async (input: { ref_type: string; name: string; description?: string; data?: any; is_default?: boolean }) => {
      const { data, error } = await (supabase as any)
        .from('visual_reference_sets')
        .insert({
          project_id: projectId,
          ref_type: input.ref_type,
          name: input.name,
          description: input.description || null,
          data: input.data || null,
          is_default: input.is_default || false,
          created_by: user?.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as VisualReferenceSet;
    },
    onSuccess: () => {
      toast.success('Reference pack created');
      qc.invalidateQueries({ queryKey: ['visual-ref-sets', projectId] });
    },
    onError: (err: any) => toast.error('Failed: ' + err.message),
  });

  const updateRefSet = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<VisualReferenceSet> }) => {
      const { error } = await (supabase as any)
        .from('visual_reference_sets')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visual-ref-sets', projectId] });
    },
  });

  const deleteRefSet = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('visual_reference_sets')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Reference pack deleted');
      qc.invalidateQueries({ queryKey: ['visual-ref-sets', projectId] });
      qc.invalidateQueries({ queryKey: ['visual-ref-assets', projectId] });
    },
  });

  const uploadRefImage = useMutation({
    mutationFn: async ({ refSetId, file }: { refSetId: string; file: File }) => {
      const ext = file.name.split('.').pop() || 'png';
      const path = `${projectId}/visual-refs/${refSetId}/${crypto.randomUUID()}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('projects')
        .upload(path, file, { upsert: false });
      if (uploadErr) throw uploadErr;

      const { error: insertErr } = await (supabase as any)
        .from('visual_reference_assets')
        .insert({
          project_id: projectId,
          reference_set_id: refSetId,
          storage_path: path,
          mime_type: file.type || 'image/png',
          created_by: user?.id,
        });
      if (insertErr) throw insertErr;
      return path;
    },
    onSuccess: () => {
      toast.success('Reference image uploaded');
      qc.invalidateQueries({ queryKey: ['visual-ref-assets', projectId] });
    },
    onError: (err: any) => toast.error('Upload failed: ' + err.message),
  });

  const deleteRefAsset = useMutation({
    mutationFn: async ({ id, storagePath }: { id: string; storagePath: string }) => {
      await supabase.storage.from('projects').remove([storagePath]);
      const { error } = await (supabase as any)
        .from('visual_reference_assets')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['visual-ref-assets', projectId] });
    },
  });

  const getImageUrl = async (path: string) => {
    const { data } = await supabase.storage.from('projects').createSignedUrl(path, 3600);
    return data?.signedUrl || null;
  };

  return {
    refSets, characters, locations, styles, defaultStyle,
    refAssets, setsLoading, assetsLoading,
    createRefSet, updateRefSet, deleteRefSet,
    uploadRefImage, deleteRefAsset, getImageUrl,
  };
}
