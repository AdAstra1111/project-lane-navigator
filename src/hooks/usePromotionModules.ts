import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ---- Budget Assumptions ----
export function useBudgetAssumptions(projectId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['budget-assumptions', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('budget_assumptions')
        .select('*')
        .eq('project_id', projectId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

  const update = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      if (!query.data?.id) throw new Error('No assumptions to update');
      const { error } = await supabase
        .from('budget_assumptions')
        .update(updates)
        .eq('id', query.data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-assumptions', projectId] });
      toast.success('Budget assumptions updated');
    },
  });

  return { assumptions: query.data, isLoading: query.isLoading, updateAssumptions: update.mutate };
}

// ---- Packaging Items ----
export function usePackagingItems(projectId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['packaging-items', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('packaging_items')
        .select('*')
        .eq('project_id', projectId)
        .order('priority', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, any>) => {
      const { error } = await supabase.from('packaging_items').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packaging-items', projectId] }),
  });

  const addItem = useMutation({
    mutationFn: async (item: { item_type: string; name: string; archetype: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !projectId) throw new Error('Not authenticated');
      const { error } = await supabase.from('packaging_items').insert({
        ...item, user_id: user.id, project_id: projectId, status: 'TARGET',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packaging-items', projectId] });
      toast.success('Packaging item added');
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('packaging_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['packaging-items', projectId] }),
  });

  return {
    items: query.data || [],
    isLoading: query.isLoading,
    updateItem: updateItem.mutate,
    addItem: addItem.mutate,
    deleteItem: deleteItem.mutate,
  };
}

// ---- Stage Gates ----
export function useStageGates(projectId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['stage-gates', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('stage_gates')
        .select('*')
        .eq('project_id', projectId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId,
  });

  const updateGate = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Record<string, any>) => {
      const { error } = await supabase.from('stage_gates').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stage-gates', projectId] }),
  });

  return {
    gates: query.data || [],
    isLoading: query.isLoading,
    updateGate: updateGate.mutate,
  };
}
