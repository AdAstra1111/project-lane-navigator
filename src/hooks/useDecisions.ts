import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface ProjectDecision {
  id: string;
  project_id: string;
  user_id: string;
  title: string;
  context: string;
  decision: string;
  reasoning: string;
  outcome: string;
  decision_type: string;
  status: string;
  decided_at: string;
  created_at: string;
  updated_at: string;
}

export function useDecisions(projectId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['decisions', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('project_decisions')
        .select('*')
        .eq('project_id', projectId)
        .order('decided_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ProjectDecision[];
    },
    enabled: !!projectId,
  });

  const addDecision = useMutation({
    mutationFn: async (input: Partial<ProjectDecision>) => {
      if (!user || !projectId) throw new Error('Missing context');
      const { error } = await (supabase as any)
        .from('project_decisions')
        .insert({ ...input, project_id: projectId, user_id: user.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions', projectId] });
      toast.success('Decision logged');
    },
  });

  const updateDecision = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<ProjectDecision>) => {
      const { error } = await (supabase as any)
        .from('project_decisions')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions', projectId] });
      toast.success('Decision updated');
    },
  });

  const deleteDecision = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from('project_decisions')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['decisions', projectId] });
      toast.success('Decision removed');
    },
  });

  return { decisions, isLoading, addDecision, updateDecision, deleteDecision };
}
