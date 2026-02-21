import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ScenarioRecommendation {
  id: string;
  project_id: string;
  recommended_scenario_id: string;
  confidence: number;
  reasons: string[];
  tradeoffs: Record<string, number>;
  risk_flags: string[];
  created_at: string;
}

export interface RecommendationResult {
  recommendedScenarioId: string;
  recommendedScenarioName: string | null;
  confidence: number;
  scoresByScenario: { scenarioId: string; scores: Record<string, number>; metrics: Record<string, unknown> }[];
  reasons: string[];
  tradeoffs: Record<string, number>;
  riskFlags: string[];
}

export function useScenarioRecommendation(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: recommendation, isLoading } = useQuery({
    queryKey: ['scenario-recommendation', projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from('scenario_recommendations')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ScenarioRecommendation | null;
    },
    enabled: !!projectId,
  });

  const { data: scores = [] } = useQuery({
    queryKey: ['scenario-scores', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('scenario_scores')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!projectId,
  });

  const computeRecommendation = useMutation({
    mutationFn: async (params?: { baselineScenarioId?: string; activeScenarioId?: string }) => {
      const { data, error } = await supabase.functions.invoke('simulation-engine', {
        body: { action: 'recommend_scenario', projectId, ...params },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as RecommendationResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenario-recommendation', projectId] });
      queryClient.invalidateQueries({ queryKey: ['scenario-scores', projectId] });
      toast.success('Recommendation computed');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return {
    recommendation,
    scores,
    isLoading,
    computeRecommendation,
  };
}
