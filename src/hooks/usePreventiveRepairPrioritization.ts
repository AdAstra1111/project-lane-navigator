/**
 * usePreventiveRepairPrioritization — Fetches PRP1 + conditionally NRF1 data.
 * Read-only. TanStack Query pattern.
 * NRF1 is only fetched when axis_debt_map is needed and PRP1 doesn't provide it.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface PRP1Repair {
  repair_id: string;
  repair_type: string;
  status: string;
  baseline_rank: number;
  preventive_rank: number;
  rank_delta: number;
  baseline_score: number;
  preventive_score: number;
  uplift_amount: number;
  current_priority_signal: number;
  preventive_value_signal: number;
  preventive_confidence_signal: number;
  root_cause_signal: number;
  execution_friction_signal: number;
  explanation_tags: string[];
  forecasted_repair_families: string[];
}

export interface PRP1Data {
  ok: boolean;
  action: string;
  project_id: string;
  current_nsi?: number;
  current_stability_band?: string;
  prp1_prioritization: {
    project_repair_pressure: number;
    project_repair_pressure_raw: number;
    total_repairs_considered: number;
    repairs_with_preventive_uplift: number;
    highest_preventive_uplift_repair_id: string | null;
    prioritized_repairs: PRP1Repair[];
    prioritization_disclaimer: string;
  };
  scoring_notes: Record<string, string>;
  computed_at: string;
  nrf1_degraded?: boolean;
}

export interface AxisDebtEntry {
  axis: string;
  risk_level: string;
  source_repair_count: number;
  max_forecast_confidence: number;
  forecast_repair_families: string[];
  notes: string[];
}

export interface NRF1Data {
  ok: boolean;
  nrf1_forecast: {
    project_repair_pressure: number;
    project_repair_pressure_raw: number;
    forecasted_repair_families: string[];
    per_repair_forecasts: any[];
  };
  axis_debt_map: AxisDebtEntry[];
}

export interface PRP2StrategyOption {
  repair_id: string;
  repair_type: string;
  strategic_priority_score: number;
  recommendation_confidence: number;
  primary_signals: string[];
}

export interface PRP2AxisHotspot {
  axis: string;
  risk_level: string;
  source_repair_count: number;
}

export interface PRP2Data {
  ok: boolean;
  selected_repair_id: string;
  selected_repair_type: string;
  strategic_priority_score: number;
  recommendation_confidence: number;
  selection_rationale: string;
  reduced_axis_debt: string[];
  prevented_repair_families: string[];
  unlocks_repairs: string[];
  ranked_strategy_options: PRP2StrategyOption[];
  axis_debt_hotspots?: PRP2AxisHotspot[];
  scoring_notes?: Record<string, string>;
}

async function fetchPRP1(projectId: string): Promise<PRP1Data> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'preventive_repair_prioritization',
      projectId,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`PRP1 failed: ${resp.status}${body ? ` — ${body}` : ''}`);
  }

  const json = await resp.json();
  if (!json?.ok) throw new Error(json?.error ?? 'Invalid PRP1 response');
  return json as PRP1Data;
}

async function fetchNRF1(projectId: string): Promise<NRF1Data | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'forecast_repair_pressure',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as NRF1Data;
}

async function fetchPRP2(projectId: string): Promise<PRP2Data | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'select_preventive_strategy',
      projectId,
    }),
  });

  if (!resp.ok) return null;
  const json = await resp.json();
  if (!json?.ok) return null;
  return json as PRP2Data;
}

export function usePreventiveRepairPrioritization(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const prp1Key = ['prp1-prioritization', projectId];
  const nrf1Key = ['nrf1-forecast-strategy', projectId];
  const prp2Key = ['prp2-strategy', projectId];

  const prp1Query = useQuery({
    queryKey: prp1Key,
    queryFn: () => fetchPRP1(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const needsNrf1 = !!projectId && !!prp1Query.data && !prp1Query.data.nrf1_degraded;

  const nrf1Query = useQuery({
    queryKey: nrf1Key,
    queryFn: () => fetchNRF1(projectId!),
    enabled: needsNrf1,
    staleTime: 60_000,
  });

  const prp2Query = useQuery({
    queryKey: prp2Key,
    queryFn: () => fetchPRP2(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: prp1Key });
    queryClient.invalidateQueries({ queryKey: nrf1Key });
    queryClient.invalidateQueries({ queryKey: prp2Key });
  }, [queryClient]);

  return {
    prp1: prp1Query.data ?? null,
    nrf1: nrf1Query.data ?? null,
    prp2: prp2Query.data ?? null,
    isLoading: prp1Query.isLoading,
    nrf1Loading: nrf1Query.isLoading,
    prp2Loading: prp2Query.isLoading,
    error: prp1Query.error?.message ?? null,
    refresh,
  };
}
