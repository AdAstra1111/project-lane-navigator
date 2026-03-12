/**
 * useProjectedNarrativeStability — TanStack hook for NSI3 projected stability.
 * Calls project_narrative_stability backend action.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export type ProjectedEffect =
  | 'stabilizing'
  | 'likely_improving'
  | 'neutral'
  | 'likely_destabilizing'
  | 'destabilizing'
  | 'unknown';

export interface ProjectedNarrativeStabilityData {
  project_id: string;
  proposal_id: string;
  proposal_status: string;
  current_nsi: number | null;
  current_stability_band: string | null;
  projected_effect: ProjectedEffect;
  projected_delta: number;
  projected_nsi_range: { low: number; high: number } | null;
  projection_basis: string;
  projection_note: string;
  stale_warning: string | null;
  evaluated_at: string;
}

async function fetchProjectedStability(
  projectId: string,
  proposalId: string,
): Promise<ProjectedNarrativeStabilityData> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const res = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'project_narrative_stability',
      projectId,
      proposal_id: proposalId,
    }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Projected stability request failed');

  return json as ProjectedNarrativeStabilityData;
}

export function useProjectedNarrativeStability(
  projectId: string | undefined,
  proposalId: string | undefined,
  enabled: boolean = false,
) {
  const queryClient = useQueryClient();
  const queryKey = ['projected-stability', proposalId];

  const { data = null, isLoading, error: queryError } = useQuery({
    queryKey,
    queryFn: () => fetchProjectedStability(projectId!, proposalId!),
    enabled: !!projectId && !!proposalId && enabled,
    staleTime: 30_000,
  });

  const error = queryError ? (queryError as Error).message : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, proposalId]);

  return { data, isLoading, error, refresh };
}
