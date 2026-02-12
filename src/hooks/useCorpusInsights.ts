import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface CorpusCalibration {
  production_type: string;
  sample_size: number;
  median_page_count: number;
  median_scene_count: number;
  median_runtime: number;
  median_dialogue_ratio: number;
  median_cast_size: number;
  median_location_count: number;
  median_midpoint_position: number;
  median_climax_position: number;
  median_avg_scene_length: number;
  median_quality_score: number;
  vfx_rate: number;
  budget_distribution: Record<string, number>;
}

export interface CorpusPlaybook {
  name: string;
  description: string;
  operations: string[];
  applicable_production_types?: string[];
  priority?: number;
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

export function useCalibrationForType(productionType: string | undefined) {
  const { data: calibrations } = useCorpusCalibrations();
  if (!productionType || !calibrations) return null;
  const pt = productionType.toLowerCase();
  return calibrations.find(c => {
    const cpt = c.production_type.toLowerCase();
    return cpt === pt || pt.includes(cpt) || cpt.includes(pt);
  }) || null;
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
      toast.success(`Aggregated ${data.total} scripts into ${data.groups} format models`);
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

export function computeDeviation(value: number | null | undefined, median: number | null | undefined): number | null {
  if (value == null || median == null || median === 0) return null;
  return Math.round(((value - median) / median) * 100);
}
