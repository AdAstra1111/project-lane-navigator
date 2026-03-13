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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['pitch-ideas'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      const msg = (data as any)?.generating
        ? 'Project created — documents are generating in background'
        : 'Project created with Concept Lock attached';
      toast.success(msg);
    },
    onError: (e: any) => toast.error(e.message || 'Promotion failed'),
  });

  return { promote: mutation.mutateAsync, promoting: mutation.isPending };
}
