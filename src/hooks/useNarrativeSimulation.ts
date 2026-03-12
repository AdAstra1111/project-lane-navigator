/**
 * useNarrativeSimulation — Hook for the simulate_narrative_impact action.
 * Read-only predictive simulation. Never alters runtime state.
 * Fail-closed: returns null on error.
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RepairStrategy } from '@/hooks/useSelectiveRegenerationPlan';

export interface AxisRiskScore {
  source_axis: string;
  target_axis: string;
  risk_score: number;
  chain_length: number;
  dependency_type: string;
  confidence_factor: number;
}

export interface AffectedAxisEnriched {
  axis: string;
  label: string;
  class: 'A' | 'B' | 'S' | 'C';
  severity: string;
  is_direct: boolean;
  chain_length: number | null;
}

export interface SimulationResult {
  ok: boolean;
  simulation_state: 'impact_found' | 'no_impact' | 'unavailable';
  impacted_scene_count: number;
  direct_scene_count: number;
  propagated_scene_count: number;
  entity_link_scene_count: number;
  entity_propagation_scene_count: number;
  risk_sources: string[];
  recommended_scope: string;
  // SIM2 enrichment fields
  blast_radius_score: number;
  impact_band: 'none' | 'limited' | 'moderate' | 'broad' | 'systemic';
  dependency_risk_scores: AxisRiskScore[];
  affected_axes_enriched: AffectedAxisEnriched[];
  simulation_confidence: number;
  structural_uncertainty_reason: string | null;
}

interface SimulationInput {
  unit_keys?: string[];
  axis_keys?: string[];
  repair_strategy?: RepairStrategy;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;
const CACHE_TTL = 30_000;

function inputHash(input: SimulationInput): string {
  return JSON.stringify({
    u: input.unit_keys?.sort() ?? [],
    a: input.axis_keys?.sort() ?? [],
    s: input.repair_strategy ?? 'balanced',
  });
}

export function useNarrativeSimulation(projectId: string | undefined) {
  const [data, setData] = useState<SimulationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, { result: SimulationResult; ts: number }>>(new Map());

  const simulate = useCallback(async (input: SimulationInput) => {
    if (!projectId) return;

    const hash = inputHash(input);
    const cached = cacheRef.current.get(hash);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setData(cached.result);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Authentication required');
        setIsLoading(false);
        return;
      }

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'simulate_narrative_impact',
          projectId,
          ...input,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        setError(`Simulation failed: ${resp.status}${errBody ? ` — ${errBody}` : ''}`);
        setData(null);
        setIsLoading(false);
        return;
      }

      const result = await resp.json();
      if (!result?.ok) {
        setError(result?.error ?? 'Simulation returned invalid response');
        setData(null);
        setIsLoading(false);
        return;
      }

      const simResult = result as SimulationResult;
      cacheRef.current.set(hash, { result: simResult, ts: Date.now() });
      setData(simResult);
    } catch (e: any) {
      setError(e?.message ?? 'Simulation request failed');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  return { data, simulate, isLoading, error };
}
