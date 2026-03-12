/**
 * useRecommendedRepairPaths — Fetches recommended multi-step repair paths from backend.
 * Read-only. TanStack Query pattern.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface RepairPathStep {
  repair_id: string;
  repair_type: string;
  scope_key?: string;
  summary: string;
  proposal_required: boolean;
}

export interface RepairPath {
  path_label: string;
  path_score: number;
  steps: RepairPathStep[];
  expected_stability_gain: number;
  blast_risk: number;
  execution_friction: number;
  urgency: number;
  notes?: string[];
}

export interface ExcludedRepair {
  repair_id: string;
  repair_type: string;
  reason: string;
}

export interface RecommendedRepairPathsData {
  candidate_repair_count: number;
  path_count: number;
  paths: RepairPath[];
  excluded_repairs: ExcludedRepair[];
}

async function fetchRepairPaths(projectId: string): Promise<RecommendedRepairPathsData> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'recommend_repair_paths',
      projectId,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Repair paths failed: ${resp.status}${body ? ` — ${body}` : ''}`);
  }

  const json = await resp.json();
  if (!json?.ok) throw new Error(json?.error ?? 'Invalid response');
  return json as RecommendedRepairPathsData;
}

export function useRecommendedRepairPaths(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['recommended-repair-paths', projectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchRepairPaths(projectId!),
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
