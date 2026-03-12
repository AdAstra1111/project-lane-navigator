/**
 * useNarrativeStability — Fetches Narrative Stability Index (NSI) via TanStack Query.
 *
 * NSI is an OS-layer operational metric. It must NOT be confused with CI/GP
 * (creative integrity or greenlight probability). This is purely structural.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export type StabilityBand = 'stable' | 'watch' | 'fragile' | 'unstable' | 'critical';

export interface NarrativeStabilityData {
  narrative_stability_index: number;
  stability_band: StabilityBand;
  structural_health_score: number;
  blast_risk_score: number;
  repair_flow_score: number;
  intelligence_alignment_score: number;
  contributing_factors: {
    diagnostics_summary: {
      critical: number;
      high: number;
      warning: number;
      info: number;
      penalty: number;
    };
    simulation_summary: {
      active_simulation_risk_count: number;
      highest_blast_band: string;
      total_blast_penalty: number;
      simulation_source: string;
    };
    repair_summary: {
      failed_repairs: number;
      blocked_issues: number;
      awaiting_proposal: number;
      awaiting_approval: number;
      repair_readiness: string;
      exhausted_flag: boolean;
      total_repair_penalty: number;
    };
    intelligence_summary: {
      narrative_health_score: number;
      story_risk_score: number;
      inverted_risk: number;
    };
  };
  calibration_version: string;
  computed_at: string;
}

async function fetchNarrativeStability(projectId: string): Promise<NarrativeStabilityData> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const res = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'get_narrative_stability', projectId }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Narrative stability request failed');

  return {
    narrative_stability_index:   json.narrative_stability_index,
    stability_band:              json.stability_band,
    structural_health_score:     json.structural_health_score,
    blast_risk_score:            json.blast_risk_score,
    repair_flow_score:           json.repair_flow_score,
    intelligence_alignment_score: json.intelligence_alignment_score,
    contributing_factors:        json.contributing_factors ?? {},
    calibration_version:         json.calibration_version ?? 'nsi2',
    computed_at:                 json.computed_at,
  } as NarrativeStabilityData;
}

export function useNarrativeStability(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['narrative-stability', projectId];

  const { data = null, isLoading, error: queryError } = useQuery({
    queryKey,
    queryFn: () => fetchNarrativeStability(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const error = queryError ? (queryError as Error).message : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey[1]]);

  return { data, isLoading, error, refresh };
}
