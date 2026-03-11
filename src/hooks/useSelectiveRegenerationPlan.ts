/**
 * useSelectiveRegenerationPlan — Read-only hook for the selective regeneration planner.
 *
 * Calls dev-engine-v2 action: selective_regeneration_plan
 * Returns the minimum regeneration scope when narrative units are stale/contradicted.
 * Fail-closed: returns null when projectId missing, auth missing, or engine errors.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface SourceUnit {
  unit_key: string;
  axis: string;
  dependency_position: 'root' | 'upstream' | 'propagated' | 'terminal';
  priority_score?: number;
  sequence_order?: number;
}

export interface ImpactedScene {
  scene_key: string;
  risk_source: 'direct' | 'propagated' | 'entity_link';
  axes?: string[];
}

export type RecommendedScope =
  | 'no_risk'
  | 'propagated_only'
  | 'targeted_scenes'
  | 'broad_impact';

export interface SelectiveRegenerationPlanResponse {
  project_id: string;
  ok: boolean;
  recommended_scope: RecommendedScope;
  source_units: SourceUnit[];
  direct_axes: string[];
  propagated_axes: string[];
  impacted_scenes: ImpactedScene[];
  impacted_scene_count: number;
  entity_impacted_scenes?: ImpactedScene[];
  entity_impacted_scene_count?: number;
  rationale: string;
  diagnostics?: string;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export type RepairStrategy = 'precision' | 'balanced' | 'stabilization';

export function useSelectiveRegenerationPlan(projectId: string | undefined, repairStrategy: RepairStrategy = 'balanced') {
  return useQuery<SelectiveRegenerationPlanResponse | null>({
    queryKey: ['selective-regeneration-plan', projectId, repairStrategy],
    queryFn: async () => {
      if (!projectId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'selective_regeneration_plan',
          projectId,
          repair_strategy: repairStrategy,
        }),
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data?.ok) return null;
      return data as SelectiveRegenerationPlanResponse;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
