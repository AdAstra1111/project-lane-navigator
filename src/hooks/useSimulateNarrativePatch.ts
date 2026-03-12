/**
 * useSimulateNarrativePatch — On-demand impact preview for patch proposals.
 * Calls simulate_narrative_patch backend action.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface SimulateNarrativePatchResult {
  proposal_id: string;
  repair_id: string;
  patch_type: 'repair_relation_graph' | 'repair_structural_beats';
  proposal_status: 'proposed' | 'stale' | 'applied' | 'rejected';
  derived_simulation_axes: string[];
  derivation_method: 'beat_axis_reference' | 'entity_type_lookup' | 'entity_type_fallback';
  simulation_basis: 'proposal_patch';
  simulation_note: string;
  simulation_state: string;
  impacted_scene_count: number;
  direct_scene_count: number;
  propagated_scene_count: number;
  entity_link_scene_count: number;
  entity_propagation_scene_count: number;
  blast_radius_score: number;
  impact_band: 'none' | 'limited' | 'moderate' | 'broad' | 'systemic';
  simulation_confidence: number | null;
  structural_uncertainty_reason: string | null;
  affected_axes_enriched?: Array<{
    axis: string;
    label: string;
    class: string;
    severity: string;
    is_direct: boolean;
    chain_length: number | null;
  }>;
}

export function useSimulateNarrativePatch(projectId: string | undefined) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [result, setResult] = useState<SimulateNarrativePatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(async (proposalId: string) => {
    if (!projectId || isPreviewing) return;
    setIsPreviewing(true);
    setError(null);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Authentication required'); return; }

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'simulate_narrative_patch',
          projectId,
          proposal_id: proposalId,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        setError(`Impact preview failed: ${resp.status}${body ? ` — ${body}` : ''}`);
        return;
      }

      const json = await resp.json();
      if (!json?.ok) {
        setError(json?.error ?? 'Impact preview returned invalid response');
        return;
      }

      setResult(json as SimulateNarrativePatchResult);
    } catch (e: any) {
      setError(e?.message ?? 'Impact preview request failed');
    } finally {
      setIsPreviewing(false);
    }
  }, [projectId, isPreviewing]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { preview, isPreviewing, result, error, reset };
}
