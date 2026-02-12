import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ModelAccuracyScore {
  id: string;
  production_type: string;
  engine_id: string;
  total_predictions: number;
  correct_predictions: number;
  accuracy_pct: number;
  avg_predicted_score: number;
  avg_actual_outcome: number;
  last_calculated_at: string;
}

export function useModelAccuracy(productionType?: string) {
  return useQuery({
    queryKey: ['model-accuracy', productionType],
    queryFn: async () => {
      let query = supabase
        .from('model_accuracy_scores')
        .select('*')
        .order('accuracy_pct', { ascending: false });

      if (productionType) {
        query = query.eq('production_type', productionType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ModelAccuracyScore[];
    },
  });
}
