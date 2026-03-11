/**
 * useRegenerationRunHistory — Queries regeneration_runs for the last N runs.
 * Read-only. Fail-closed: returns empty array on error.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface RegenerationRun {
  id: string;
  project_id: string;
  status: string;
  recommended_scope: string | null;
  target_scene_count: number | null;
  ndg_pre_at_risk_count: number | null;
  started_at: string | null;
  completed_at: string | null;
  source_unit_keys: string[] | null;
  source_axes: string[] | null;
  meta_json: Record<string, any>;
}

export function useRegenerationRunHistory(projectId: string | undefined, limit = 10) {
  return useQuery<RegenerationRun[]>({
    queryKey: ['regeneration-run-history', projectId, limit],
    queryFn: async () => {
      if (!projectId) return [];

      const { data, error } = await (supabase as any)
        .from('regeneration_runs')
        .select('id, project_id, status, recommended_scope, target_scene_count, ndg_pre_at_risk_count, started_at, completed_at, source_unit_keys, source_axes, meta_json')
        .eq('project_id', projectId)
        .order('started_at', { ascending: false })
        .limit(limit);

      if (error || !data) return [];
      return data as RegenerationRun[];
    },
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });
}
