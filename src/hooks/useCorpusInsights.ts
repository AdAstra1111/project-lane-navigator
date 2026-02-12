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
  // Try genre-specific baseline first
  if (genre && baselines?.length) {
    const g = genre.toLowerCase();
    const pt = productionType.toLowerCase();
    const match = baselines.find(b =>
      (b.production_type?.toLowerCase() === pt || pt.includes(b.production_type?.toLowerCase())) &&
      b.genre?.toLowerCase() === g
    );
    if (match) return match;
  }
  // Fall back to production type calibration
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
