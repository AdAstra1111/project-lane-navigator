import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ---- Story Trend (Signal) Types ----

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
  genre_tags: string[];
  tone_tags: string[];
  format_tags: string[];
  region: string;
  lane_relevance: string[];
}

export interface TrendWeeklyBrief {
  id: string;
  week_start: string;
  summary: string;
  created_at: string;
}

// ---- Cast Trend Types ----

export interface CastTrend {
  id: string;
  actor_name: string;
  region: string;
  age_band: string;
  trend_type: 'Emerging' | 'Accelerating' | 'Resurgent';
  explanation: string;
  genre_relevance: string[];
  market_alignment: string;
  cycle_phase: 'Early' | 'Building' | 'Peaking';
  status: 'active' | 'archived';
  first_detected_at: string;
  last_updated_at: string;
  archived_at: string | null;
  created_at: string;
}

// ---- Filter Types ----

export interface StoryFilters {
  genre?: string;
  tone?: string;
  format?: string;
  lane?: string;
  cyclePhase?: string;
  region?: string;
}

export interface CastFilters {
  region?: string;
  ageBand?: string;
  trendType?: string;
  genreRelevance?: string;
  cyclePhase?: string;
  marketAlignment?: string;
}

// ---- Story Trend Hooks ----

export function useActiveSignals(filters?: StoryFilters) {
  return useQuery({
    queryKey: ['trend-signals', 'active', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trend_signals')
        .select('*')
        .eq('status', 'active')
        .order('last_updated_at', { ascending: false });
      if (error) throw error;
      let signals = (data ?? []) as unknown as TrendSignal[];

      // Client-side filtering for array/text fields
      if (filters?.genre) {
        signals = signals.filter(s => s.genre_tags?.includes(filters.genre!));
      }
      if (filters?.tone) {
        signals = signals.filter(s => s.tone_tags?.includes(filters.tone!));
      }
      if (filters?.format) {
        signals = signals.filter(s => s.format_tags?.includes(filters.format!));
      }
      if (filters?.lane) {
        signals = signals.filter(s => s.lane_relevance?.includes(filters.lane!));
      }
      if (filters?.cyclePhase) {
        signals = signals.filter(s => s.cycle_phase === filters.cyclePhase);
      }
      if (filters?.region) {
        signals = signals.filter(s => s.region === filters.region);
      }
      return signals;
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

// ---- Cast Trend Hooks ----

export function useActiveCastTrends(filters?: CastFilters) {
  return useQuery({
    queryKey: ['cast-trends', 'active', filters],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_trends')
        .select('*')
        .eq('status', 'active')
        .order('last_updated_at', { ascending: false });
      if (error) throw error;
      let trends = (data ?? []) as unknown as CastTrend[];

      if (filters?.region) {
        trends = trends.filter(t => t.region === filters.region);
      }
      if (filters?.ageBand) {
        trends = trends.filter(t => t.age_band === filters.ageBand);
      }
      if (filters?.trendType) {
        trends = trends.filter(t => t.trend_type === filters.trendType);
      }
      if (filters?.genreRelevance) {
        trends = trends.filter(t => t.genre_relevance?.includes(filters.genreRelevance!));
      }
      if (filters?.cyclePhase) {
        trends = trends.filter(t => t.cycle_phase === filters.cyclePhase);
      }
      if (filters?.marketAlignment) {
        trends = trends.filter(t => t.market_alignment === filters.marketAlignment);
      }
      return trends;
    },
  });
}

export function useArchivedCastTrends() {
  return useQuery({
    queryKey: ['cast-trends', 'archived'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_trends')
        .select('*')
        .eq('status', 'archived')
        .order('archived_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CastTrend[];
    },
  });
}
