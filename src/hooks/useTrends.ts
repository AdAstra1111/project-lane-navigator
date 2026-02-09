import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TrendSignal {
  id: string;
  name: string;
  category: 'Narrative' | 'IP' | 'Market Behaviour';
  cycle_phase: 'Early' | 'Building' | 'Peaking' | 'Declining';
  explanation: string;
  sources_count: number;
  status: 'active' | 'archived';
  first_detected_at: string;
  last_updated_at: string;
  archived_at: string | null;
  created_at: string;
}

export interface TrendWeeklyBrief {
  id: string;
  week_start: string;
  summary: string;
  created_at: string;
}

export function useActiveSignals() {
  return useQuery({
    queryKey: ['trend-signals', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_signals')
        .select('*')
        .eq('status', 'active')
        .order('last_updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrendSignal[];
    },
  });
}

export function useArchivedSignals() {
  return useQuery({
    queryKey: ['trend-signals', 'archived'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_signals')
        .select('*')
        .eq('status', 'archived')
        .order('archived_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as TrendSignal[];
    },
  });
}

export function useLatestWeeklyBrief() {
  return useQuery({
    queryKey: ['trend-weekly-brief', 'latest'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_weekly_briefs')
        .select('*')
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TrendWeeklyBrief | null;
    },
  });
}

export function useSignalCount() {
  return useQuery({
    queryKey: ['trend-signals', 'count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('trend_signals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      if (error) throw error;
      return count ?? 0;
    },
  });
}
