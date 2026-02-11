import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectFormat } from '@/lib/types';

// ---- Trend Scoring Types ----

export type TrendVelocity = 'Rising' | 'Stable' | 'Declining';
export type TrendSaturationRisk = 'Low' | 'Medium' | 'High';

// ---- Story Trend (Signal) Types ----

export interface TrendSignal {
  id: string;
  name: string;
  category: string;
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
  // Multi-class intelligence fields
  production_type: string;
  strength: number;
  velocity: TrendVelocity;
  saturation_risk: TrendSaturationRisk;
  forecast: string;
  budget_tier: string;
  target_buyer: string;
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
  sales_leverage: string;
  timing_window: string;
  cycle_phase: 'Early' | 'Building' | 'Peaking';
  status: 'active' | 'archived';
  first_detected_at: string;
  last_updated_at: string;
  archived_at: string | null;
  created_at: string;
  // Multi-class intelligence fields
  production_type: string;
  strength: number;
  velocity: TrendVelocity;
  saturation_risk: TrendSaturationRisk;
  forecast: string;
  budget_tier: string;
  target_buyer: string;
}

// ---- Filter Types ----

export interface StoryFilters {
  genre?: string;
  tone?: string;
  format?: string;
  lane?: string;
  cyclePhase?: string;
  region?: string;
  productionType?: string;
  budgetTier?: string;
  targetBuyer?: string;
  velocity?: string;
  saturationRisk?: string;
}

export interface CastFilters {
  region?: string;
  ageBand?: string;
  trendType?: string;
  genreRelevance?: string;
  cyclePhase?: string;
  marketAlignment?: string;
  salesLeverage?: string;
  productionType?: string;
  budgetTier?: string;
  targetBuyer?: string;
  velocity?: string;
  saturationRisk?: string;
}

// ---- Production Type Categories ----

export const PRODUCTION_TYPE_TREND_CATEGORIES: Record<string, { label: string; storyCategories: string[]; castLabel: string }> = {
  film: { label: 'Narrative Feature', storyCategories: ['Narrative', 'IP', 'Market Behaviour', 'Buyer Appetite', 'Genre Cycle'], castLabel: 'Cast Trends' },
  'tv-series': { label: 'Narrative Series', storyCategories: ['Platform Demand', 'Format Innovation', 'Showrunner Dynamics', 'Renewal Patterns', 'IP Pipeline'], castLabel: 'Cast Trends' },
  documentary: { label: 'Documentary', storyCategories: ['Subject Access', 'Impact Trends', 'Broadcaster Appetite', 'Grant Cycles', 'Archive Innovation'], castLabel: 'Subject Trends' },
  'documentary-series': { label: 'Doc Series', storyCategories: ['Platform Demand', 'Subject Access', 'Impact Trends', 'Format Innovation', 'Broadcaster Appetite'], castLabel: 'Subject Trends' },
  commercial: { label: 'Commercial', storyCategories: ['Brand Strategy', 'Creative Direction', 'Production Innovation', 'Award Cycles', 'Client Behaviour'], castLabel: 'Director Trends' },
  'branded-content': { label: 'Branded Content', storyCategories: ['Brand Strategy', 'Platform Behaviour', 'Cultural Shifts', 'Engagement Patterns', 'Content Innovation'], castLabel: 'Creator Trends' },
  'music-video': { label: 'Music Video', storyCategories: ['Visual Innovation', 'Artist Momentum', 'Platform Strategy', 'Commissioner Behaviour', 'Award Cycles'], castLabel: 'Director Trends' },
  'short-film': { label: 'Short Film', storyCategories: ['Festival Cycles', 'Talent Discovery', 'IP Incubation', 'Grant Cycles', 'Online Distribution'], castLabel: 'Emerging Talent' },
  'digital-series': { label: 'Digital / Social', storyCategories: ['Platform Algorithm', 'Creator Economy', 'Brand Integration', 'Audience Behaviour', 'Format Innovation'], castLabel: 'Creator Trends' },
  'proof-of-concept': { label: 'Proof of Concept', storyCategories: ['Lab Cycles', 'Investor Appetite', 'IP Demonstration', 'Technology Trends', 'Development Deals'], castLabel: 'Emerging Talent' },
  hybrid: { label: 'Hybrid', storyCategories: ['Cross-Platform', 'Immersive Tech', 'Innovation Funds', 'Experiential Demand', 'Transmedia'], castLabel: 'Creative Leads' },
  'vertical-drama': { label: 'Vertical Drama', storyCategories: ['Platform Algorithm', 'Scroll Retention', 'Genre Momentum', 'Cast Social Value', 'Brand Integration', 'Global Expansion'], castLabel: 'Talent & Creator Trends' },
};

export const TARGET_BUYER_OPTIONS: Record<string, { value: string; label: string }[]> = {
  film: [
    { value: 'Streamer', label: 'Streamer' }, { value: 'Studio', label: 'Studio' },
    { value: 'Indie Distributor', label: 'Indie Distributor' }, { value: 'Sales Agent', label: 'Sales Agent' },
  ],
  'tv-series': [
    { value: 'Streamer', label: 'Streamer' }, { value: 'Broadcaster', label: 'Broadcaster' },
    { value: 'Studio', label: 'Studio' }, { value: 'Platform', label: 'Platform' },
  ],
  commercial: [
    { value: 'Brand', label: 'Brand' }, { value: 'Agency', label: 'Agency' },
    { value: 'Direct Client', label: 'Direct Client' },
  ],
  'branded-content': [
    { value: 'Brand', label: 'Brand' }, { value: 'Agency', label: 'Agency' },
    { value: 'Social Platform', label: 'Social Platform' },
  ],
  'music-video': [
    { value: 'Label', label: 'Label' }, { value: 'Artist Direct', label: 'Artist Direct' },
    { value: 'Commissioner', label: 'Commissioner' },
  ],
  'digital-series': [
    { value: 'Social Platform', label: 'Social Platform' }, { value: 'Brand', label: 'Brand' },
    { value: 'Streamer', label: 'Streamer' },
  ],
  documentary: [
    { value: 'Broadcaster', label: 'Broadcaster' }, { value: 'Streamer', label: 'Streamer' },
    { value: 'Impact Funder', label: 'Impact Funder' }, { value: 'Sales Agent', label: 'Sales Agent' },
  ],
  'documentary-series': [
    { value: 'Broadcaster', label: 'Broadcaster' }, { value: 'Streamer', label: 'Streamer' },
    { value: 'Platform', label: 'Platform' },
  ],
  'short-film': [
    { value: 'Festival', label: 'Festival' }, { value: 'Online Platform', label: 'Online Platform' },
    { value: 'Grant Body', label: 'Grant Body' },
  ],
  'proof-of-concept': [
    { value: 'Investor', label: 'Investor' }, { value: 'Streamer', label: 'Streamer' },
    { value: 'Studio', label: 'Studio' },
  ],
  hybrid: [
    { value: 'Tech Partner', label: 'Tech Partner' }, { value: 'Brand', label: 'Brand' },
    { value: 'Arts Council', label: 'Arts Council' },
  ],
  'vertical-drama': [
    { value: 'Platform', label: 'Platform (ReelShort, ShortMax, etc.)' }, { value: 'Brand', label: 'Brand' },
    { value: 'Distributor', label: 'Global Distributor' }, { value: 'Ad Network', label: 'Ad Network' },
  ],
};

export const BUDGET_TIER_OPTIONS = [
  { value: 'Micro', label: 'Micro' },
  { value: 'Low', label: 'Low' },
  { value: 'Mid', label: 'Mid' },
  { value: 'Upper-Mid', label: 'Upper-Mid' },
  { value: 'High', label: 'High' },
  { value: 'Studio-Scale', label: 'Studio-Scale' },
];

// ---- Story Trend Hooks ----

export function useActiveSignals(filters?: StoryFilters) {
  return useQuery({
    queryKey: ['trend-signals', 'active', filters],
    queryFn: async () => {
      let query = supabase
        .from('trend_signals')
        .select('*')
        .eq('status', 'active')
        .order('last_updated_at', { ascending: false });

      // Server-side filter on production_type for efficiency
      if (filters?.productionType) {
        query = query.eq('production_type', filters.productionType);
      }

      const { data, error } = await query;
      if (error) throw error;
      let signals = (data ?? []) as unknown as TrendSignal[];

      // Client-side filtering for array/text fields
      if (filters?.genre) signals = signals.filter(s => s.genre_tags?.includes(filters.genre!));
      if (filters?.tone) signals = signals.filter(s => s.tone_tags?.includes(filters.tone!));
      if (filters?.format) signals = signals.filter(s => s.format_tags?.includes(filters.format!));
      if (filters?.lane) signals = signals.filter(s => s.lane_relevance?.includes(filters.lane!));
      if (filters?.cyclePhase) signals = signals.filter(s => s.cycle_phase === filters.cyclePhase);
      if (filters?.region) signals = signals.filter(s => s.region === filters.region);
      if (filters?.budgetTier) signals = signals.filter(s => s.budget_tier === filters.budgetTier);
      if (filters?.targetBuyer) signals = signals.filter(s => s.target_buyer === filters.targetBuyer);
      if (filters?.velocity) signals = signals.filter(s => s.velocity === filters.velocity);
      if (filters?.saturationRisk) signals = signals.filter(s => s.saturation_risk === filters.saturationRisk);
      return signals;
    },
  });
}

export function useArchivedSignals(productionType?: string) {
  return useQuery({
    queryKey: ['trend-signals', 'archived', productionType],
    queryFn: async () => {
      let query = supabase
        .from('trend_signals')
        .select('*')
        .eq('status', 'archived')
        .order('archived_at', { ascending: false })
        .limit(50);

      if (productionType) {
        query = query.eq('production_type', productionType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as TrendSignal[];
    },
  });
}

export function useLatestWeeklyBrief(productionType?: string) {
  return useQuery({
    queryKey: ['trend-weekly-brief', productionType || 'all'],
    queryFn: async () => {
      let query = supabase
        .from('trend_weekly_briefs')
        .select('*')
        .order('week_start', { ascending: false })
        .limit(1);
      if (productionType) {
        query = query.eq('production_type', productionType);
      }
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as unknown as TrendWeeklyBrief | null;
    },
  });
}

export function useSignalCount(productionType?: string) {
  return useQuery({
    queryKey: ['trend-signals', 'count', productionType],
    queryFn: async () => {
      let query = supabase
        .from('trend_signals')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      if (productionType) {
        query = query.eq('production_type', productionType);
      }

      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useTrendCountsByType() {
  return useQuery({
    queryKey: ['trend-counts-by-type'],
    queryFn: async () => {
      const [signalsRes, castRes] = await Promise.all([
        supabase.from('trend_signals').select('production_type').eq('status', 'active'),
        supabase.from('cast_trends').select('production_type').eq('status', 'active'),
      ]);
      if (signalsRes.error) throw signalsRes.error;
      if (castRes.error) throw castRes.error;

      const counts: Record<string, { signals: number; cast: number }> = {};
      for (const row of signalsRes.data ?? []) {
        const pt = row.production_type || 'film';
        if (!counts[pt]) counts[pt] = { signals: 0, cast: 0 };
        counts[pt].signals++;
      }
      for (const row of castRes.data ?? []) {
        const pt = row.production_type || 'film';
        if (!counts[pt]) counts[pt] = { signals: 0, cast: 0 };
        counts[pt].cast++;
      }
      return counts;
    },
  });
}

// ---- Cast Trend Hooks ----

export function useActiveCastTrends(filters?: CastFilters) {
  return useQuery({
    queryKey: ['cast-trends', 'active', filters],
    queryFn: async () => {
      let query = supabase
        .from('cast_trends')
        .select('*')
        .eq('status', 'active')
        .order('last_updated_at', { ascending: false });

      if (filters?.productionType) {
        query = query.eq('production_type', filters.productionType);
      }

      const { data, error } = await query;
      if (error) throw error;
      let trends = (data ?? []) as unknown as CastTrend[];

      if (filters?.region) trends = trends.filter(t => t.region === filters.region);
      if (filters?.ageBand) trends = trends.filter(t => t.age_band === filters.ageBand);
      if (filters?.trendType) trends = trends.filter(t => t.trend_type === filters.trendType);
      if (filters?.genreRelevance) trends = trends.filter(t => t.genre_relevance?.includes(filters.genreRelevance!));
      if (filters?.cyclePhase) trends = trends.filter(t => t.cycle_phase === filters.cyclePhase);
      if (filters?.marketAlignment) trends = trends.filter(t => t.market_alignment === filters.marketAlignment);
      if (filters?.salesLeverage) trends = trends.filter(t => t.sales_leverage === filters.salesLeverage);
      if (filters?.budgetTier) trends = trends.filter(t => t.budget_tier === filters.budgetTier);
      if (filters?.targetBuyer) trends = trends.filter(t => t.target_buyer === filters.targetBuyer);
      if (filters?.velocity) trends = trends.filter(t => t.velocity === filters.velocity);
      if (filters?.saturationRisk) trends = trends.filter(t => t.saturation_risk === filters.saturationRisk);
      return trends;
    },
  });
}

export function useArchivedCastTrends(productionType?: string) {
  return useQuery({
    queryKey: ['cast-trends', 'archived', productionType],
    queryFn: async () => {
      let query = supabase
        .from('cast_trends')
        .select('*')
        .eq('status', 'archived')
        .order('archived_at', { ascending: false })
        .limit(50);

      if (productionType) {
        query = query.eq('production_type', productionType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as CastTrend[];
    },
  });
}
