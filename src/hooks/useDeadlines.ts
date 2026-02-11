import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ProjectDeadline {
  id: string;
  project_id: string;
  user_id: string;
  label: string;
  deadline_type: string;
  due_date: string;
  notes: string;
  completed: boolean;
  created_at: string;
  updated_at: string;
}

export function useDeadlines(projectId?: string) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: deadlines = [], isLoading } = useQuery({
    queryKey: ['project-deadlines', projectId],
    queryFn: async () => {
      let query = supabase
        .from('project_deadlines' as any)
        .select('*')
        .order('due_date', { ascending: true });

      if (projectId) {
        query = query.eq('project_id', projectId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ProjectDeadline[];
    },
    enabled: !!user,
  });

  const addDeadline = useMutation({
    mutationFn: async (input: { project_id: string; label: string; due_date: string; deadline_type?: string; notes?: string }) => {
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('project_deadlines' as any)
        .insert({
          project_id: input.project_id,
          user_id: user.id,
          label: input.label,
          due_date: input.due_date,
          deadline_type: input.deadline_type || 'custom',
          notes: input.notes || '',
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deadlines'] });
      toast.success('Deadline added');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleComplete = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const { error } = await supabase
        .from('project_deadlines' as any)
        .update({ completed })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deadlines'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDeadline = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('project_deadlines' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-deadlines'] });
      toast.success('Deadline removed');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { deadlines, isLoading, addDeadline, toggleComplete, deleteDeadline };
}

/** Fetch ALL deadlines across all projects for dashboard use */
export function useAllDeadlines() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['all-project-deadlines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_deadlines' as any)
        .select('*')
        .eq('completed', false)
        .order('due_date', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ProjectDeadline[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}
