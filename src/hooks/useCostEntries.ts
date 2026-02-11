import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CostEntry {
  id: string;
  project_id: string;
  budget_id: string | null;
  user_id: string;
  category: string;
  description: string;
  amount: number;
  entry_date: string;
  vendor: string;
  receipt_ref: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function useProjectCostEntries(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-cost-entries', projectId];

  const { data: entries = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_cost_entries')
        .select('*')
        .eq('project_id', projectId)
        .order('entry_date', { ascending: false });
      if (error) throw error;
      return data as unknown as CostEntry[];
    },
    enabled: !!projectId,
  });

  const addEntry = useMutation({
    mutationFn: async (input: Partial<CostEntry>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_cost_entries').insert({
        project_id: projectId!,
        user_id: user.id,
        budget_id: input.budget_id || null,
        category: input.category || 'other',
        description: input.description || '',
        amount: input.amount || 0,
        entry_date: input.entry_date || new Date().toISOString().slice(0, 10),
        vendor: input.vendor || '',
        receipt_ref: input.receipt_ref || '',
        notes: input.notes || '',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Cost entry added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_cost_entries').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Entry removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { entries, isLoading, addEntry, deleteEntry };
}
