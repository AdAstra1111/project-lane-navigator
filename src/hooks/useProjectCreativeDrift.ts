/**
 * Hook: loads project lane prefs (benchmark/feel) + latest cinematic quality run metrics.
 * Used by CreativeDriftCard and TrendSuggestedActions.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { loadProjectLaneRulesetPrefs, type RulesetPrefs } from '@/lib/rulesets/uiState';
import {
  getBenchmarkDefaults,
  getDefaultBenchmark,
  getDefaultFeel,
  type StyleBenchmark,
  type PacingFeel,
  type BenchmarkResult,
} from '@/lib/rulesets/styleBenchmarks';

export interface DriftMetrics {
  melodrama_score: number;
  nuance_score: number;
  similarity_risk: number;
  final_score: number;
  final_pass: boolean;
  hard_failures: string[];
  diagnostic_flags: string[];
  run_id: string;
  created_at: string;
}

export type HealthStatus = 'healthy' | 'drifting' | 'at_risk';

export interface CreativeDriftData {
  prefs: RulesetPrefs;
  benchmark: StyleBenchmark;
  feel: PacingFeel;
  benchmarkDefaults: BenchmarkResult;
  drift: DriftMetrics | null;
  health: HealthStatus;
}

const MELODRAMA_THRESHOLD = 0.62;
const SIMILARITY_THRESHOLD = 0.55;

export function computeHealth(drift: DriftMetrics | null): HealthStatus {
  if (!drift) return 'healthy'; // no data = assume healthy
  const melodramaHigh = drift.melodrama_score > MELODRAMA_THRESHOLD;
  const similarityHigh = drift.similarity_risk > SIMILARITY_THRESHOLD;
  const hasHardFailures = drift.hard_failures.length > 0;
  if ((melodramaHigh && similarityHigh) || hasHardFailures) return 'at_risk';
  if (melodramaHigh || similarityHigh) return 'drifting';
  return 'healthy';
}

export function useProjectCreativeDrift(projectId: string | undefined, lane: string) {
  return useQuery({
    queryKey: ['creative-drift', projectId, lane],
    queryFn: async (): Promise<CreativeDriftData> => {
      if (!projectId) throw new Error('No project ID');

      // Load prefs
      const prefs = await loadProjectLaneRulesetPrefs(projectId, lane);
      const benchmark = (prefs.style_benchmark as StyleBenchmark) || getDefaultBenchmark(lane);
      const feel = (prefs.pacing_feel as PacingFeel) || getDefaultFeel(lane);
      const benchmarkDefaults = getBenchmarkDefaults(lane, benchmark, feel);

      // Load latest quality run
      let drift: DriftMetrics | null = null;
      try {
        const { data, error } = await (supabase as any)
          .from('cinematic_quality_runs')
          .select('id, final_score, final_pass, hard_failures, diagnostic_flags, metrics_json, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          const m = (data.metrics_json || {}) as Record<string, any>;
          drift = {
            melodrama_score: m.melodrama_score ?? m.melodrama ?? 0,
            nuance_score: m.nuance_score ?? m.nuance ?? 0,
            similarity_risk: m.similarity_risk ?? m.similarity ?? 0,
            final_score: data.final_score ?? 0,
            final_pass: data.final_pass ?? true,
            hard_failures: data.hard_failures ?? [],
            diagnostic_flags: data.diagnostic_flags ?? [],
            run_id: data.id,
            created_at: data.created_at,
          };
        }
      } catch {
        // graceful fallback
      }

      return {
        prefs,
        benchmark,
        feel,
        benchmarkDefaults,
        drift,
        health: computeHealth(drift),
      };
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
