/**
 * React Query hooks for trailer clip attempt history.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { clipEngineApi } from '@/lib/trailerPipeline/clipApi';
import { toast } from 'sonner';

export interface ClipAttempt {
  id: string;
  clip_id: string | null;
  attempt_index: number;
  status: string;
  provider: string | null;
  model: string | null;
  eval_score: number | null;
  eval_failures: string[] | null;
  eval_metrics: Record<string, unknown> | null;
  output_public_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  error: string | null;
  prompt_version: string | null;
  settings: Record<string, unknown>;
}

export function useClipAttempts(clipId: string | undefined) {
  return useQuery({
    queryKey: ['trailer-clip-attempts', clipId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trailer_clip_attempts' as any)
        .select('*')
        .eq('clip_id', clipId!)
        .order('attempt_index', { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ClipAttempt[];
    },
    enabled: !!clipId,
  });
}

export function usePromoteAttempt(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { clipId: string; attemptId: string }) =>
      clipEngineApi.promoteAttempt(projectId!, params.clipId, params.attemptId),
    onSuccess: () => {
      toast.success('Attempt promoted as best');
      qc.invalidateQueries({ queryKey: ['trailer-clips-list'] });
      qc.invalidateQueries({ queryKey: ['trailer-clip-attempts'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useRetryClipAttempt(projectId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clipId: string) =>
      clipEngineApi.retryClipAttempt(projectId!, clipId),
    onSuccess: () => {
      toast.success('Escalated retry enqueued');
      qc.invalidateQueries({ queryKey: ['trailer-clips-list'] });
      qc.invalidateQueries({ queryKey: ['trailer-clip-attempts'] });
      qc.invalidateQueries({ queryKey: ['trailer-clip-progress'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
