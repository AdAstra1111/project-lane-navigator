import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface ScoreSnapshot {
  id: string;
  project_id: string;
  readiness_score: number;
  finance_readiness_score: number;
  snapshot_date: string;
  created_at: string;
}

export function useScoreHistory(projectId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['score-history', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await (supabase as any)
        .from('readiness_score_history')
        .select('*')
        .eq('project_id', projectId)
        .order('snapshot_date', { ascending: true })
        .limit(30);
      if (error) throw error;
      return (data || []) as ScoreSnapshot[];
    },
    enabled: !!projectId,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ readinessScore, financeScore }: { readinessScore: number; financeScore: number }) => {
      if (!projectId || !user) return;
      const today = new Date().toISOString().split('T')[0];
      const { error } = await (supabase as any)
        .from('readiness_score_history')
        .upsert(
          {
            project_id: projectId,
            user_id: user.id,
            readiness_score: readinessScore,
            finance_readiness_score: financeScore,
            snapshot_date: today,
          },
          { onConflict: 'project_id,snapshot_date' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['score-history', projectId] });
    },
  });

  return { history, isLoading, saveSnapshot: saveMutation.mutate };
}

/** Auto-save a daily snapshot whenever scores change */
export function useAutoSaveScore(
  projectId: string | undefined,
  readinessScore: number | null,
  financeScore: number | null,
) {
  const { saveSnapshot } = useScoreHistory(projectId);

  useEffect(() => {
    if (!projectId || readinessScore == null || financeScore == null) return;
    saveSnapshot({ readinessScore, financeScore });
    // Only save once per mount / score change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, readinessScore, financeScore]);
}
