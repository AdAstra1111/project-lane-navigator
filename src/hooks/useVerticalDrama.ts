import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface VerticalDataSource {
  id: string;
  source_name: string;
  region: string;
  source_type: string;
  refresh_frequency: string;
  reliability_score: number;
  category: string;
  url: string;
  notes: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface VerticalTrendSnapshot {
  id: string;
  snapshot_date: string;
  region: string;
  top_apps: any[];
  revenue_shifts: any[];
  top_micro_genres: any[];
  episode_patterns: Record<string, any>;
  raw_data: Record<string, any>;
  created_at: string;
}

export function useVerticalDataSources(region?: string) {
  return useQuery({
    queryKey: ['vertical-data-sources', region],
    queryFn: async () => {
      let query = supabase
        .from('vertical_data_sources')
        .select('*')
        .eq('status', 'active')
        .order('category', { ascending: true });

      if (region) {
        query = query.eq('region', region);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as VerticalDataSource[];
    },
  });
}

export function useVerticalTrendSnapshots(limit = 10) {
  return useQuery({
    queryKey: ['vertical-trend-snapshots', limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vertical_trend_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as unknown as VerticalTrendSnapshot[];
    },
  });
}

export function useLatestVerticalSnapshot(region?: string) {
  return useQuery({
    queryKey: ['vertical-trend-snapshot-latest', region],
    queryFn: async () => {
      let query = supabase
        .from('vertical_trend_snapshots')
        .select('*')
        .order('snapshot_date', { ascending: false })
        .limit(1);

      if (region) {
        query = query.eq('region', region);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as unknown as VerticalTrendSnapshot | null;
    },
  });
}
