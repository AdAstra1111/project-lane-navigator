import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface DataSource {
  id: string;
  source_name: string;
  production_types_supported: string[];
  intelligence_layer: string;
  source_type: string;
  region: string;
  refresh_frequency: string;
  last_refresh: string | null;
  data_staleness_score: number;
  reliability_score: number;
  volatility_score: number;
  status: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface EngineSourceMapping {
  id: string;
  engine_id: string;
  source_id: string;
  source_weight: number;
  validation_method: string;
  status: string;
}

export interface ModelVersionEntry {
  id: string;
  version_label: string;
  production_type: string;
  change_type: string;
  changes: any;
  reason: string;
  triggered_by: string;
  created_at: string;
}

/** Compute staleness penalty: 0–1 where 1 = fully stale */
export function computeStalenessPenalty(
  lastRefresh: string | null,
  refreshFrequency: string,
): number {
  if (!lastRefresh) return 0.5; // unknown freshness
  const daysSince = (Date.now() - new Date(lastRefresh).getTime()) / (1000 * 60 * 60 * 24);
  const maxDays: Record<string, number> = { daily: 3, weekly: 14, monthly: 45, quarterly: 120 };
  const limit = maxDays[refreshFrequency] || 45;
  if (daysSince <= limit) return 0;
  if (daysSince >= limit * 3) return 0.6;
  return Math.min(0.6, ((daysSince - limit) / (limit * 2)) * 0.6);
}

/** Effective engine confidence = base × (1 - staleness_penalty) × reliability */
export function effectiveSourceConfidence(
  sources: DataSource[],
  mappings: EngineSourceMapping[],
  engineId: string,
): { confidence: number; freshest: string | null; staleCount: number; totalSources: number } {
  const engineMappings = mappings.filter(m => m.engine_id === engineId && m.status === 'active');
  if (engineMappings.length === 0) return { confidence: 0.8, freshest: null, staleCount: 0, totalSources: 0 };

  let totalWeight = 0;
  let weightedConfidence = 0;
  let staleCount = 0;
  let freshest: string | null = null;

  for (const mapping of engineMappings) {
    const source = sources.find(s => s.id === mapping.source_id);
    if (!source || source.status !== 'active') continue;

    const penalty = computeStalenessPenalty(source.last_refresh, source.refresh_frequency);
    const conf = source.reliability_score * (1 - penalty);
    weightedConfidence += conf * mapping.source_weight;
    totalWeight += mapping.source_weight;
    if (penalty > 0) staleCount++;
    if (source.last_refresh && (!freshest || source.last_refresh > freshest)) {
      freshest = source.last_refresh;
    }
  }

  return {
    confidence: totalWeight > 0 ? weightedConfidence / totalWeight : 0.8,
    freshest,
    staleCount,
    totalSources: engineMappings.length,
  };
}

export function useDataSources(productionType?: string) {
  return useQuery({
    queryKey: ['data-sources', productionType],
    queryFn: async () => {
      let query = supabase.from('data_sources').select('*').eq('status', 'active');
      const { data, error } = await query.order('source_name');
      if (error) throw error;
      // Filter by production type client-side (array contains)
      if (productionType) {
        return (data as unknown as DataSource[]).filter(
          s => s.production_types_supported.length === 0 || s.production_types_supported.includes(productionType)
        );
      }
      return data as unknown as DataSource[];
    },
  });
}

export function useEngineSourceMappings() {
  return useQuery({
    queryKey: ['engine-source-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('engine_source_map')
        .select('*')
        .eq('status', 'active');
      if (error) throw error;
      return data as unknown as EngineSourceMapping[];
    },
  });
}

export function useModelVersionLog(productionType?: string) {
  return useQuery({
    queryKey: ['model-version-log', productionType],
    queryFn: async () => {
      let query = supabase.from('model_version_log').select('*').order('created_at', { ascending: false }).limit(20);
      if (productionType) query = query.eq('production_type', productionType);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as ModelVersionEntry[];
    },
    enabled: !!productionType,
  });
}
