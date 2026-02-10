import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { PipelineStage } from '@/lib/types';

export function usePipelineStage() {
  const queryClient = useQueryClient();

  const updateStage = useMutation({
    mutationFn: async ({ projectId, stage }: { projectId: string; stage: PipelineStage }) => {
      const { error } = await supabase
        .from('projects')
        .update({ pipeline_stage: stage } as any)
        .eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { updateStage };
}
