import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PromoteParams {
  pitchIdeaId: string;
  title: string;
  budgetBand: string;
  lane: string;
}

export function usePromoteIdea() {
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ pitchIdeaId, title, budgetBand, lane }: PromoteParams) => {
      const { data, error } = await supabase.functions.invoke('promote-locked-idea', {
        body: { pitchIdeaId, title, budgetBand, lane },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { projectId: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created with Concept Lock attached');
    },
    onError: (e: any) => toast.error(e.message || 'Promotion failed'),
  });

  return { promote: mutation.mutateAsync, promoting: mutation.isPending };
}
