import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface CorpusCalibration {
  production_type: string;
  sample_size: number;
  median_page_count: number;
  min_page_count: number;
  max_page_count: number;
  p25_page_count: number;
  p75_page_count: number;
  median_scene_count: number;
  min_scene_count: number;
  max_scene_count: number;
  p25_scene_count: number;
  p75_scene_count: number;
  median_runtime: number;
  median_dialogue_ratio: number;
  p25_dialogue_ratio: number;
  p75_dialogue_ratio: number;
  median_cast_size: number;
  p25_cast_size: number;
  p75_cast_size: number;
  median_location_count: number;
  p25_location_count: number;
  p75_location_count: number;
  median_midpoint_position: number;
  median_climax_position: number;
  median_avg_scene_length: number;
  median_quality_score: number;
  median_int_ext_ratio: number;
  median_day_night_ratio: number;
  vfx_rate: number;
  budget_distribution: Record<string, number>;
  style_profile?: {
    avg_scene_length: number;
    dialogue_action_ratio: number;
    pacing_density: number;
  };
}

export interface BaselineProfile extends CorpusCalibration {
  genre: string;
}

export interface StyleProfile {
  name: string;
  description: string;
  target_scene_length: number;
  target_dialogue_ratio: number;
  target_pacing_density: number;
}

export interface LaneNorm extends CorpusCalibration {
  lane_name: string;
}

export interface CorpusPlaybook {
  name: string;
  description: string;
  operations: string[];
  applicable_production_types?: string[];
  priority?: number;
  trigger_conditions?: string[];
  target_scores?: string[];
}

export function useCorpusCalibrations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-calibrations', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_insights' as any)
        .select('*')
        .eq('insight_type', 'calibration');
      if (error) throw error;
      return (data || []).map((row: any) => ({
        production_type: row.production_type,
        ...row.pattern,
      })) as CorpusCalibration[];
    },
    enabled: !!user,
  });
}

export function useBaselineProfiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-baselines', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_insights' as any)
        .select('*')
        .eq('insight_type', 'baseline_profile');
      if (error) throw error;
      return (data || []).map((row: any) => ({
        production_type: row.production_type,
        ...row.pattern,
      })) as BaselineProfile[];
    },
    enabled: !!user,
  });
}

export function useStyleProfiles() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-styles', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_insights' as any)
        .select('*')
        .eq('insight_type', 'style_profile');
      if (error) throw error;
      return (data || []).flatMap((row: any) =>
        (row.pattern?.styles || []).map((s: any) => ({
          ...s,
          production_type: row.production_type,
        }))
      ) as (StyleProfile & { production_type: string })[];
    },
    enabled: !!user,
  });
}

export function useLaneNorms() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-lane-norms', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_insights' as any)
        .select('*')
        .eq('insight_type', 'lane_norm');
      if (error) throw error;
      return (data || []).map((row: any) => ({
        ...row.pattern,
        lane: row.lane,
      })) as LaneNorm[];
    },
    enabled: !!user,
  });
}

export function useCorpusPlaybooks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-playbooks', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_insights' as any)
        .select('*')
        .eq('insight_type', 'playbook');
      if (error) throw error;
      return (data || []).map((row: any) => row.pattern as CorpusPlaybook);
    },
    enabled: !!user,
  });
}

export function useGoldBaseline(productionType: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-gold-baseline', user?.id, productionType],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_insights' as any)
        .select('*')
        .eq('insight_type', 'gold_baseline');
      if (error) throw error;
      if (!data?.length) return null;
      const pt = (productionType || '').toLowerCase();
      const match = (data as any[]).find((row: any) => {
        const cpt = (row.production_type || '').toLowerCase();
        return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
      });
      if (match?.pattern) return match.pattern as CorpusCalibration;
      const allMatch = (data as any[]).find((r: any) => r.production_type === 'all');
      return allMatch?.pattern as CorpusCalibration | null ?? null;
    },
    enabled: !!user,
  });
}

/** Market defaults for minimum page counts when corpus data is insufficient */
export const MARKET_DEFAULT_MINS: Record<string, number> = {
  'feature': 80, 'film': 80, 'feature-film': 80,
  'tv-pilot': 45, 'tv-series': 45, 'tv_60': 45,
  'tv_30': 22, 'half-hour': 22,
  'short-film': 8, 'short': 8,
  'documentary': 45, 'doc-feature': 45,
  'vertical': 5, 'vertical-drama': 5,
};

export const MARKET_DEFAULT_TARGETS: Record<string, { pages: number; scenes: number }> = {
  'feature': { pages: 95, scenes: 55 }, 'film': { pages: 95, scenes: 55 },
  'tv-pilot': { pages: 55, scenes: 30 }, 'tv-series': { pages: 55, scenes: 30 },
  'tv_30': { pages: 32, scenes: 20 }, 'half-hour': { pages: 32, scenes: 20 },
  'short-film': { pages: 15, scenes: 10 }, 'short': { pages: 15, scenes: 10 },
  'documentary': { pages: 60, scenes: 25 }, 'doc-feature': { pages: 60, scenes: 25 },
  'vertical': { pages: 8, scenes: 6 },
};

export type CalibrationConfidence = 'high' | 'medium' | 'low';
export type CalibrationSource = 'genre_baseline' | 'type_calibration' | 'gold_baseline' | 'market_default';

export interface ResolvedCalibration {
  pattern: CorpusCalibration;
  confidence: CalibrationConfidence;
  source: CalibrationSource;
  minimumPages: number;
}

/**
 * Smart calibration resolver with sample-size aware fallback.
 * Returns calibration with confidence label and enforced market-default floor.
 */
export function useResolvedCalibration(productionType: string | undefined, genre: string | undefined) {
  const { data: calibrations } = useCorpusCalibrations();
  const { data: baselines } = useBaselineProfiles();
  const { data: goldData } = useGoldBaseline(productionType);

  if (!productionType) return null;
  const pt = productionType.toLowerCase();
  const g = (genre || '').toLowerCase();

  // 1. Try genre baseline (if sample_size >= 8)
  if (g && baselines?.length) {
    const match = baselines.find(b =>
      (b.production_type?.toLowerCase() === pt || pt.includes(b.production_type?.toLowerCase())) &&
      b.genre?.toLowerCase() === g
    );
    if (match && (match.sample_size || 0) >= 8) {
      const minPages = Math.min(Math.max(match.p25_page_count || 0, MARKET_DEFAULT_MINS[pt] || 80), 110);
      return { pattern: match, confidence: 'high' as CalibrationConfidence, source: 'genre_baseline' as CalibrationSource, minimumPages: minPages };
    }
  }

  // 2. Try production_type calibration (if sample_size >= 8)
  if (calibrations?.length) {
    const match = calibrations.find(c => {
      const cpt = c.production_type.toLowerCase();
      return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
    });
    if (match && (match.sample_size || 0) >= 8) {
      const minPages = Math.min(Math.max(match.p25_page_count || 0, MARKET_DEFAULT_MINS[pt] || 80), 110);
      return { pattern: match, confidence: 'high' as CalibrationConfidence, source: 'type_calibration' as CalibrationSource, minimumPages: minPages };
    }
    // sample 3-7: medium confidence
    if (match && (match.sample_size || 0) >= 3) {
      const minPages = Math.min(Math.max(match.p25_page_count || 0, MARKET_DEFAULT_MINS[pt] || 80), 110);
      return { pattern: match, confidence: 'medium' as CalibrationConfidence, source: 'type_calibration' as CalibrationSource, minimumPages: minPages };
    }
  }

  // 3. Try gold baseline as fallback
  if (goldData && (goldData.sample_size || 0) >= 3) {
    const minPages = Math.min(Math.max(goldData.p25_page_count || 0, MARKET_DEFAULT_MINS[pt] || 80), 110);
    const conf: CalibrationConfidence = (goldData.sample_size || 0) >= 8 ? 'high' : 'medium';
    return { pattern: goldData, confidence: conf, source: 'gold_baseline' as CalibrationSource, minimumPages: minPages };
  }

  // 4. Market default fallback
  const defaults = MARKET_DEFAULT_TARGETS[pt] || MARKET_DEFAULT_TARGETS['feature'];
  const minPages = MARKET_DEFAULT_MINS[pt] || 80;
  const fallback: CorpusCalibration = {
    production_type: pt,
    sample_size: 0,
    median_page_count: defaults.pages,
    min_page_count: minPages,
    max_page_count: defaults.pages + 30,
    p25_page_count: minPages,
    p75_page_count: defaults.pages + 15,
    median_scene_count: defaults.scenes,
    min_scene_count: Math.round(defaults.scenes * 0.6),
    max_scene_count: Math.round(defaults.scenes * 1.5),
    p25_scene_count: Math.round(defaults.scenes * 0.8),
    p75_scene_count: Math.round(defaults.scenes * 1.2),
    median_runtime: defaults.pages,
    median_dialogue_ratio: 0.45,
    p25_dialogue_ratio: 0.35,
    p75_dialogue_ratio: 0.55,
    median_cast_size: 12,
    p25_cast_size: 8,
    p75_cast_size: 18,
    median_location_count: 20,
    p25_location_count: 12,
    p75_location_count: 30,
    median_midpoint_position: 0.5,
    median_climax_position: 0.85,
    median_avg_scene_length: 1.8,
    median_quality_score: 70,
    median_int_ext_ratio: 0.6,
    median_day_night_ratio: 0.7,
    vfx_rate: 0.3,
    budget_distribution: {},
  };
  return { pattern: fallback, confidence: 'low' as CalibrationConfidence, source: 'market_default' as CalibrationSource, minimumPages: minPages };
}

export function useCalibrationForType(productionType: string | undefined) {
  const { data: calibrations } = useCorpusCalibrations();
  if (!productionType || !calibrations) return null;
  const pt = productionType.toLowerCase();
  return calibrations.find(c => {
    const cpt = c.production_type.toLowerCase();
    return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
  }) || null;
}

export function useBaselineForProject(productionType: string | undefined, genre: string | undefined) {
  const { data: baselines } = useBaselineProfiles();
  const calibration = useCalibrationForType(productionType);
  if (!productionType) return null;
  if (genre && baselines?.length) {
    const g = genre.toLowerCase();
    const pt = productionType.toLowerCase();
    const match = baselines.find(b =>
      (b.production_type?.toLowerCase() === pt || pt.includes(b.production_type?.toLowerCase())) &&
      b.genre?.toLowerCase() === g
    );
    if (match) return match;
  }
  return calibration;
}

export function useAnalyzeCorpusScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scriptId: string) => {
      const { data, error } = await supabase.functions.invoke('analyze-corpus', {
        body: { action: 'analyze', script_id: scriptId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['corpus-scripts'] });
      toast.success('Script analysis complete');
    },
    onError: (e) => toast.error(`Analysis failed: ${e.message}`),
  });
}

export function useAggregateCorpus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('analyze-corpus', {
        body: { action: 'aggregate' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['corpus-calibrations'] });
      qc.invalidateQueries({ queryKey: ['corpus-baselines'] });
      qc.invalidateQueries({ queryKey: ['corpus-styles'] });
      qc.invalidateQueries({ queryKey: ['corpus-lane-norms'] });
      const counts = data.insights_generated || {};
      const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ');
      toast.success(`Aggregated ${data.total} scripts → ${parts}`);
    },
    onError: (e) => toast.error(`Aggregation failed: ${e.message}`),
  });
}

export function useGeneratePlaybooks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('analyze-corpus', {
        body: { action: 'generate-playbooks' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['corpus-playbooks'] });
      toast.success(`Generated ${data.playbooks} rewrite playbooks`);
    },
    onError: (e) => toast.error(`Playbook generation failed: ${e.message}`),
  });
}

export function useToggleGoldFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scriptId, gold }: { scriptId: string; gold: boolean }) => {
      const { data, error } = await supabase.functions.invoke('analyze-corpus', {
        body: { action: 'toggle-gold', script_id: scriptId, gold },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['corpus-scripts'] });
      toast.success(vars.gold ? 'Marked as gold standard' : 'Removed gold standard flag');
    },
    onError: (e) => toast.error(`Failed: ${e.message}`),
  });
}

export function computeDeviation(value: number | null | undefined, median: number | null | undefined): number | null {
  if (value == null || median == null || median === 0) return null;
  return Math.round(((value - median) / median) * 100);
}

export function computeDeviationFromRange(
  value: number | null | undefined,
  low: number | null | undefined,
  high: number | null | undefined
): { deviation: number; status: 'within' | 'below' | 'above' } | null {
  if (value == null || low == null || high == null) return null;
  if (value < low) return { deviation: Math.round(((value - low) / low) * 100), status: 'below' };
  if (value > high) return { deviation: Math.round(((value - high) / high) * 100), status: 'above' };
  return { deviation: 0, status: 'within' };
}

/** Fetch all corpus scripts with quality/truncation metadata for the health dashboard */
export function useCorpusHealth() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['corpus-health', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('corpus_scripts' as any)
        .select('id, title, production_type, word_count, clean_word_count, page_count, page_count_estimate, normalized_page_est, raw_page_est, scene_count, ingestion_source, is_truncated, truncation_reason, parse_confidence, ingestion_status, analysis_status, is_transcript, transcript_confidence, exclude_from_baselines, approved_sources(title)')
        .order('is_truncated', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

/** Re-ingest a truncated script by uploading a new file (PDF/FDX/TXT).
 *  After successful re-ingest, auto-triggers analysis + aggregate rebuild if the script became healthy. */
export function useReingestScript() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scriptId, fileContent, fileName, fileType }: { scriptId: string; fileContent: string; fileName: string; fileType: string }) => {
      // 1. Re-ingest the script
      const { data, error } = await supabase.functions.invoke('ingest-corpus', {
        body: { action: 'reingest', script_id: scriptId, file_content: fileContent, file_name: fileName, file_type: fileType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // 2. If script is now healthy, auto-trigger analysis + rebuild
      if (!data.isTruncated) {
        try {
          // Trigger analysis for this script
          await supabase.functions.invoke('analyze-corpus', {
            body: { action: 'analyze', script_id: scriptId },
          });
          // Trigger aggregate rebuild
          await supabase.functions.invoke('analyze-corpus', {
            body: { action: 'aggregate' },
          });
        } catch {
          // Non-fatal: analysis/rebuild can be done manually
        }
      }

      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['corpus-health'] });
      qc.invalidateQueries({ queryKey: ['corpus-scripts'] });
      qc.invalidateQueries({ queryKey: ['corpus-calibrations'] });
      qc.invalidateQueries({ queryKey: ['corpus-baselines'] });
      qc.invalidateQueries({ queryKey: ['corpus-gold-baseline'] });
      const healthMsg = data.isTruncated ? ' (still truncated)' : ' ✓ healthy — baselines rebuilding';
      toast.success(`Re-ingested: ${data.wordCount?.toLocaleString()} words, ~${data.pageEstimate} pages${healthMsg}`);
    },
    onError: (e) => toast.error(`Re-ingest failed: ${e.message}`),
  });
}
