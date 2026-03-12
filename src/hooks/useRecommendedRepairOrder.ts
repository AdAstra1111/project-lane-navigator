/**
 * useRecommendedRepairOrder — Fetches recommended repair order from backend.
 * Read-only. TanStack Query pattern.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface RepairRecommendation {
  priority_rank: number;
  repair_id: string;
  repair_type: string;
  repairability: string;
  summary: string | null;
  source_system: string | null;
  severity: string | null;
  load_class: string | null;
  resolution_state: string;
  recommendation_label: string;
  net_priority_score: number;
  expected_stability_gain: number;
  blast_risk_score: number;
  execution_friction_score: number;
  urgency_score: number;
  proposal_required: boolean;
  proposal_id: string | null;
  proposal_status: string | null;
  projected_effect: string | null;
  affected_axes: string[];
  notes: string[];
}

export interface BlockedRepair {
  repair_id: string;
  repair_type: string;
  reason: string;
  next_action: string;
}

export interface RecommendedRepairOrderData {
  current_nsi: number;
  current_stability_band: string;
  repair_count: number;
  recommendations: RepairRecommendation[];
  blocked_repairs: BlockedRepair[];
}

async function fetchRepairOrder(projectId: string): Promise<RecommendedRepairOrderData> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'recommend_repair_order',
      projectId,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Repair order failed: ${resp.status}${body ? ` — ${body}` : ''}`);
  }

  const json = await resp.json();
  if (!json?.ok) throw new Error(json?.error ?? 'Invalid response');
  return json as RecommendedRepairOrderData;
}

export function useRecommendedRepairOrder(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['recommended-repair-order', projectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchRepairOrder(projectId!),
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
