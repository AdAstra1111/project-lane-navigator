import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { useState } from 'react';
import type { TrendEngine, EngineWeight, EngineScore } from '@/lib/trend-viability';

export function useTrendEngines() {
  return useQuery({
    queryKey: ['trend-engines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_engines')
        .select('*')
        .eq('status', 'active')
        .order('engine_name');
      if (error) throw error;
      return data as unknown as TrendEngine[];
    },
  });
}

export function useEngineWeights(productionType: string | undefined) {
  return useQuery({
    queryKey: ['engine-weights', productionType],
    queryFn: async () => {
      if (!productionType) return [];
      const { data, error } = await supabase
        .from('production_engine_weights')
        .select('engine_id, weight_value')
        .eq('production_type', productionType);
      if (error) throw error;
      return data as EngineWeight[];
    },
    enabled: !!productionType,
  });
}

export function useProjectEngineScores(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['engine-scores', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('project_engine_scores')
        .select('*')
        .eq('project_id', projectId);
      if (error) throw error;
      return data as unknown as EngineScore[];
    },
    enabled: !!projectId,
  });

  const upsertScore = useMutation({
    mutationFn: async (input: { engineId: string; score: number; notes?: string }) => {
      if (!projectId || !user) throw new Error('Missing context');
      const { error } = await supabase
        .from('project_engine_scores')
        .upsert({
          project_id: projectId,
          engine_id: input.engineId,
          user_id: user.id,
          score: input.score,
          source: 'manual',
          notes: input.notes || '',
          confidence: 'high',
          last_scored_at: new Date().toISOString(),
        }, { onConflict: 'project_id,engine_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['engine-scores', projectId] });
      toast.success('Engine score updated');
    },
    onError: () => toast.error('Failed to update score'),
  });

  return { scores: query.data || [], isLoading: query.isLoading, upsertScore };
}

export function usePredictionOutcomes(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['prediction-outcomes', projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('prediction_outcomes')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId,
  });

  const recordOutcome = useMutation({
    mutationFn: async (input: {
      predicted_viability: number;
      actual_financing_outcome: string;
      distribution_type?: string;
      revenue_if_known?: string;
      notes?: string;
    }) => {
      if (!projectId || !user) throw new Error('Missing context');
      const { error } = await supabase
        .from('prediction_outcomes')
        .insert({
          project_id: projectId,
          user_id: user.id,
          predicted_viability: input.predicted_viability,
          actual_financing_outcome: input.actual_financing_outcome,
          distribution_type: input.distribution_type || '',
          revenue_if_known: input.revenue_if_known || '',
          notes: input.notes || '',
          outcome_recorded_at: new Date().toISOString(),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prediction-outcomes', projectId] });
      toast.success('Outcome recorded');
    },
    onError: () => toast.error('Failed to record outcome'),
  });

  return { outcomes: query.data || [], isLoading: query.isLoading, recordOutcome };
}

export function useAIEngineScoring(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const [isScoring, setIsScoring] = useState(false);

  const scoreEngines = async () => {
    if (!projectId) return;
    setIsScoring(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('score-engines', {
        body: { project_id: projectId },
      });

      if (response.error) throw response.error;

      queryClient.invalidateQueries({ queryKey: ['engine-scores', projectId] });
      toast.success(`${response.data.engines_scored} engines scored by AI`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to score engines');
    } finally {
      setIsScoring(false);
    }
  };

  return { scoreEngines, isScoring };
}

export function useRecalibrateWeights() {
  const queryClient = useQueryClient();
  const [isRecalibrating, setIsRecalibrating] = useState(false);

  const recalibrate = async () => {
    setIsRecalibrating(true);
    try {
      const response = await supabase.functions.invoke('recalibrate-weights', {});

      if (response.error) throw response.error;

      if (response.data.recalibrated) {
        queryClient.invalidateQueries({ queryKey: ['engine-weights'] });
        toast.success(`Weights recalibrated: ${response.data.weights_updated} updated`);
      } else {
        toast.info(response.data.message || 'Not enough data to recalibrate');
      }
      return response.data;
    } catch (err: any) {
      toast.error(err.message || 'Failed to recalibrate');
    } finally {
      setIsRecalibrating(false);
    }
  };

  return { recalibrate, isRecalibrating };
}
