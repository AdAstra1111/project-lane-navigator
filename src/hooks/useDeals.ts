import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProjectDeal {
  id: string;
  project_id: string;
  user_id: string;
  territory: string;
  buyer_name: string;
  deal_type: string;
  status: string;
  minimum_guarantee: string;
  currency: string;
  notes: string;
  offered_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

const DEAL_STATUSES = ['offered', 'negotiating', 'term-sheet', 'closed', 'passed'] as const;
const DEAL_TYPES = ['all-rights', 'theatrical', 'streaming', 'broadcast', 'home-ent', 'airline', 'other'] as const;

export { DEAL_STATUSES, DEAL_TYPES };

export function useProjectDeals(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['project-deals', projectId];

  const { data: deals = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_deals')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as ProjectDeal[];
    },
    enabled: !!projectId,
  });

  const addDeal = useMutation({
    mutationFn: async (input: Partial<ProjectDeal>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('project_deals').insert({
        project_id: projectId!,
        user_id: user.id,
        territory: input.territory || '',
        buyer_name: input.buyer_name || '',
        deal_type: input.deal_type || 'all-rights',
        status: input.status || 'offered',
        minimum_guarantee: input.minimum_guarantee || '',
        currency: input.currency || 'USD',
        notes: input.notes || '',
        offered_at: input.offered_at || new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deal added'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateDeal = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ProjectDeal> & { id: string }) => {
      const { error } = await supabase.from('project_deals').update(updates).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deal updated'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteDeal = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('project_deals').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey }); toast.success('Deal removed'); },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalMG = deals
    .filter(d => d.status === 'closed' && d.minimum_guarantee)
    .reduce((sum, d) => sum + (parseFloat(d.minimum_guarantee.replace(/[^0-9.]/g, '')) || 0), 0);

  return { deals, isLoading, addDeal, updateDeal, deleteDeal, totalMG };
}
