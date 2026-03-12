/**
 * useEvaluatedRepairPaths — CSP1 sequential evaluation of repair paths.
 * Read-only. TanStack Query pattern.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface SequentialAdjustments {
  effective_gain: number;
  effective_blast: number;
  effective_friction: number;
  gain_delta: number;
  blast_delta: number;
  friction_delta: number;
  reasons: string[];
}

export interface EvaluatedStep {
  repair_id: string;
  repair_type: string;
  scope_key?: string;
  proposal_required: boolean;
  sequential_adjustments: SequentialAdjustments;
}

export interface EvaluatedPath {
  path_id: string;
  path_label: string;
  sequential_effect_label: string;
  baseline_path_score: number;
  adjusted_path_score: number;
  adjustment_delta: number;
  confidence: string;
  interaction_notes: string[];
  steps: EvaluatedStep[];
}

export interface EvaluatedRepairPathsData {
  project_id: string;
  path_count: number;
  evaluated_paths: EvaluatedPath[];
}

async function fetchEvaluatedRepairPaths(projectId: string): Promise<EvaluatedRepairPathsData> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'evaluate_repair_paths',
      projectId,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Evaluate repair paths failed: ${resp.status}${body ? ` — ${body}` : ''}`);
  }

  const json = await resp.json();
  if (!json?.ok) throw new Error(json?.error ?? 'Invalid response');
  return json as EvaluatedRepairPathsData;
}

export function useEvaluatedRepairPaths(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['evaluated-repair-paths', projectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchEvaluatedRepairPaths(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  return {
    data: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
  };
}
