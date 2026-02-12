import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Types ──

export interface PostMilestone {
  id: string;
  project_id: string;
  user_id: string;
  milestone_type: string;
  label: string;
  status: string;
  due_date: string | null;
  completed_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface EditVersion {
  id: string;
  project_id: string;
  user_id: string;
  version_label: string;
  notes: string;
  screening_score: number | null;
  created_at: string;
}

export interface VfxShot {
  id: string;
  project_id: string;
  user_id: string;
  shot_id: string;
  vendor: string;
  status: string;
  due_date: string | null;
  complexity: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

// ── Milestones ──

export function usePostMilestones(projectId: string | undefined) {
  const qc = useQueryClient();
  const key = ['post-milestones', projectId];

  const { data: milestones = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('post_milestones')
        .select('*')
        .eq('project_id', projectId)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as PostMilestone[];
    },
    enabled: !!projectId,
  });

  const add = useMutation({
    mutationFn: async (input: Partial<PostMilestone>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('post_milestones')
        .insert({ ...input, project_id: projectId!, user_id: user.id } as any)
        .select().single();
      if (error) throw error;
      return data as PostMilestone;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Milestone added'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PostMilestone> & { id: string }) => {
      const { error } = await supabase.from('post_milestones').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('post_milestones').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Milestone removed'); },
    onError: (e: any) => toast.error(e.message),
  });

  return { milestones, isLoading, add, update, remove };
}

// ── Edit Versions ──

export function useEditVersions(projectId: string | undefined) {
  const qc = useQueryClient();
  const key = ['edit-versions', projectId];

  const { data: versions = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('edit_versions')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EditVersion[];
    },
    enabled: !!projectId,
  });

  const add = useMutation({
    mutationFn: async (input: Partial<EditVersion>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('edit_versions')
        .insert({ ...input, project_id: projectId!, user_id: user.id } as any)
        .select().single();
      if (error) throw error;
      return data as EditVersion;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Edit version logged'); },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('edit_versions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('Version removed'); },
    onError: (e: any) => toast.error(e.message),
  });

  return { versions, isLoading, add, remove };
}

// ── VFX Shots ──

export function useVfxShots(projectId: string | undefined) {
  const qc = useQueryClient();
  const key = ['vfx-shots', projectId];

  const { data: shots = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('vfx_shots')
        .select('*')
        .eq('project_id', projectId)
        .order('due_date', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as VfxShot[];
    },
    enabled: !!projectId,
  });

  const add = useMutation({
    mutationFn: async (input: Partial<VfxShot>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('vfx_shots')
        .insert({ ...input, project_id: projectId!, user_id: user.id } as any)
        .select().single();
      if (error) throw error;
      return data as VfxShot;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('VFX shot added'); },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<VfxShot> & { id: string }) => {
      const { error } = await supabase.from('vfx_shots').update(updates as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('vfx_shots').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success('VFX shot removed'); },
    onError: (e: any) => toast.error(e.message),
  });

  return { shots, isLoading, add, update, remove };
}
