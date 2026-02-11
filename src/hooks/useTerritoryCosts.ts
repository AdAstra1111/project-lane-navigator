import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TerritoryCostEntry {
  id: string;
  territory: string;
  region: string;
  currency: string;
  crew_day_rate_low: number;
  crew_day_rate_high: number;
  stage_day_rate: number;
  location_permit_avg: number;
  accommodation_day: number;
  per_diem: number;
  cost_index: number;
  labor_quality: string;
  infrastructure_rating: string;
  incentive_headline: string;
  timezone: string;
  notes: string;
  confidence: string;
  source_url: string;
  last_verified_at: string;
}

export function useTerritoryCosts() {
  return useQuery({
    queryKey: ['territory-cost-index'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('territory_cost_index')
        .select('*')
        .order('cost_index', { ascending: true });
      if (error) throw error;
      return (data || []) as TerritoryCostEntry[];
    },
  });
}
