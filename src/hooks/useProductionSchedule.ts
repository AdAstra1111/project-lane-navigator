import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectScene {
  id: string;
  project_id: string;
  scene_number: string;
  heading: string;
  location: string;
  int_ext: string;
  time_of_day: string;
  description: string;
  cast_members: string[];
  page_count: number;
  notes: string;
  created_at: string;
}

export interface ShootDay {
  id: string;
  project_id: string;
  shoot_date: string;
  day_number: number;
  unit: string;
  notes: string;
  created_at: string;
}

export interface SceneScheduleEntry {
  id: string;
  project_id: string;
  scene_id: string;
  shoot_day_id: string;
  sort_order: number;
  call_time: string | null;
  status: string;
  dependencies: string[];
  notes: string;
  created_at: string;
}

// ---- Scenes ----
export function useProjectScenes(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-scenes', projectId];

  const { data: scenes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_scenes')
        .select('*')
        .eq('project_id', projectId)
        .order('scene_number', { ascending: true });
      if (error) throw error;
      return data as unknown as ProjectScene[];
    },
    enabled: !!projectId,
  });

  const extractScenes = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('extract-scenes', {
        body: { projectId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(`Extracted ${data?.count || 0} scenes from script`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateScene = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectScene> & { id: string }) => {
      const { error } = await supabase.from('project_scenes').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteScene = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_scenes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Scene removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { scenes, isLoading, extractScenes, updateScene, deleteScene };
}

// ---- Shoot Days ----
export function useShootDays(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['shoot-days', projectId];

  const { data: shootDays = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('shoot_days')
        .select('*')
        .eq('project_id', projectId)
        .order('shoot_date', { ascending: true });
      if (error) throw error;
      return data as unknown as ShootDay[];
    },
    enabled: !!projectId,
  });

  const addShootDay = useMutation({
    mutationFn: async (input: { shoot_date: string; day_number: number; unit?: string; notes?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('shoot_days').insert({
        project_id: projectId!,
        user_id: user.id,
        shoot_date: input.shoot_date,
        day_number: input.day_number,
        unit: input.unit || 'Main Unit',
        notes: input.notes || '',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Shoot day added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteShootDay = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('shoot_days').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Shoot day removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { shootDays, isLoading, addShootDay, deleteShootDay };
}

// ---- Scene Schedule (assignments) ----
export function useSceneSchedule(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['scene-schedule', projectId];

  const { data: schedule = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('scene_schedule')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as unknown as SceneScheduleEntry[];
    },
    enabled: !!projectId,
  });

  const assignScene = useMutation({
    mutationFn: async (input: { scene_id: string; shoot_day_id: string; sort_order?: number; call_time?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('scene_schedule').insert({
        project_id: projectId!,
        user_id: user.id,
        scene_id: input.scene_id,
        shoot_day_id: input.shoot_day_id,
        sort_order: input.sort_order || 0,
        call_time: input.call_time || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success('Scene scheduled');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const unassignScene = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scene_schedule').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateScheduleEntry = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<SceneScheduleEntry> & { id: string }) => {
      const { error } = await supabase.from('scene_schedule').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  return { schedule, isLoading, assignScene, unassignScene, updateScheduleEntry };
}
