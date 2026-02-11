import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CompanyMember {
  id: string;
  company_id: string;
  user_id: string;
  email: string;
  display_name: string;
  default_role: string;
  invited_by: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useCompanyMembers(companyId?: string) {
  const queryClient = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['company-members', companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from('company_members')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as CompanyMember[];
    },
    enabled: !!companyId,
  });

  const addMember = useMutation({
    mutationFn: async (input: { email: string; displayName: string; defaultRole: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !companyId) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('company_members')
        .insert({
          company_id: companyId,
          user_id: user.id, // placeholder until they accept
          email: input.email,
          display_name: input.displayName,
          default_role: input.defaultRole,
          invited_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-members', companyId] });
      toast.success('Member added to company roster');
    },
    onError: (err: any) => {
      if (err.message?.includes('duplicate')) {
        toast.error('This email is already on the roster');
      } else {
        toast.error(err.message || 'Failed to add member');
      }
    },
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('company_members')
        .delete()
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-members', companyId] });
      toast.success('Member removed');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to remove member'),
  });

  const updateMember = useMutation({
    mutationFn: async (input: { id: string; default_role?: string; display_name?: string }) => {
      const { id, ...updates } = input;
      const { error } = await supabase
        .from('company_members')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company-members', companyId] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  });

  return { members, isLoading, addMember, removeMember, updateMember };
}

/** Get all members across all companies owned by the current user */
export function useAllCompanyMembers() {
  return useQuery({
    queryKey: ['all-company-members'],
    queryFn: async () => {
      // Get user's companies first
      const { data: companies, error: compError } = await supabase
        .from('production_companies')
        .select('id, name');
      if (compError) throw compError;
      if (!companies?.length) return [];

      const companyIds = companies.map(c => c.id);
      const { data: members, error: memError } = await supabase
        .from('company_members')
        .select('*')
        .in('company_id', companyIds);
      if (memError) throw memError;

      return (members || []).map(m => ({
        ...m,
        company_name: companies.find(c => c.id === m.company_id)?.name || '',
      }));
    },
  });
}
