/**
 * useGeneratePatchProposal — Calls propose_narrative_patch backend action.
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface ProposalGenerateResult {
  ok: boolean;
  action: string;
  project_id: string;
  repair_id: string;
  proposal_id: string;
  patch_type: string;
  patch_layer: string;
  proposed_patch: Record<string, unknown>;
  rationale: string;
  seed_snapshot_at: string;
}

export function useGeneratePatchProposal(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ProposalGenerateResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (repairId: string) => {
    if (!projectId || isGenerating) return;
    setIsGenerating(true);
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
          action: 'propose_narrative_patch',
          projectId,
          repair_id: repairId,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        setError(`Proposal generation failed: ${resp.status}${body ? ` — ${body}` : ''}`);
        return;
      }

      const json = await resp.json();
      if (!json?.ok) {
        setError(json?.error ?? 'Proposal generation returned invalid response');
        return;
      }

      setResult(json as ProposalGenerateResult);
      queryClient.invalidateQueries({ queryKey: ['narrative-patch-proposals', repairId] });
    } catch (e: any) {
      setError(e?.message ?? 'Proposal generation request failed');
    } finally {
      setIsGenerating(false);
    }
  }, [projectId, isGenerating, queryClient]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { generate, isGenerating, result, error, reset };
}
