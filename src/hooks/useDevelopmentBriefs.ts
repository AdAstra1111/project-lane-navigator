import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface DevelopmentBrief {
  id: string;
  user_id: string;
  name: string;
  production_type: string;
  genre: string;
  subgenre: string;
  budget_band: string;
  region: string;
  platform_target: string;
  audience_demo: string;
  risk_appetite: string;
  lane_preference: string;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function useDevelopmentBriefs() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: briefs = [], isLoading } = useQuery({
    queryKey: ['development-briefs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('development_briefs')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as DevelopmentBrief[];
    },
    enabled: !!user,
  });

  const saveMutation = useMutation({
    mutationFn: async (brief: Partial<DevelopmentBrief>) => {
      const { data, error } = await supabase
        .from('development_briefs')
        .insert({ ...brief, user_id: user!.id } as any)
        .select()
        .single();
      if (error) throw error;
      return data as DevelopmentBrief;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['development-briefs'] });
      toast.success('Brief saved');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<DevelopmentBrief>) => {
      const { error } = await supabase
        .from('development_briefs')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['development-briefs'] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('development_briefs').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['development-briefs'] });
      toast.success('Brief deleted');
    },
  });

  return {
    briefs,
    isLoading,
    save: saveMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: removeMutation.mutateAsync,
  };
}
