/**
 * useApplyPatchProposal — Calls apply_narrative_patch backend action.
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface PatchApplyResult {
  ok: boolean;
  action: string;
  project_id: string;
  repair_id: string;
  proposal_id: string;
  status: string;
  outcome_summary: string;
  post_dx_diagnostic_present: boolean;
  updated_layers: string[];
  sync_result: Record<string, unknown>;
}

export function useApplyPatchProposal(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const [isApplying, setIsApplying] = useState(false);
  const [result, setResult] = useState<PatchApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async (repairId: string, proposalId: string) => {
    if (!projectId || isApplying) return;
    setIsApplying(true);
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
          action: 'apply_narrative_patch',
          projectId,
          repair_id: repairId,
          proposal_id: proposalId,
          confirmed: true,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        setError(`Apply failed: ${resp.status}${body ? ` — ${body}` : ''}`);
        return;
      }

      const json = await resp.json();
      if (!json?.ok) {
        setError(json?.error ?? 'Apply returned invalid response');
        return;
      }

      setResult(json as PatchApplyResult);
      queryClient.invalidateQueries({ queryKey: ['narrative-patch-proposals', repairId] });
      queryClient.invalidateQueries({ queryKey: ['narrative-repairs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['narrative-diagnostics', projectId] });
      queryClient.invalidateQueries({ queryKey: ['story-intelligence', projectId] });
      queryClient.invalidateQueries({ queryKey: ['narrative-stability', projectId] });
    } catch (e: any) {
      setError(e?.message ?? 'Apply request failed');
    } finally {
      setIsApplying(false);
    }
  }, [projectId, isApplying, queryClient]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { apply, isApplying, result, error, reset };
}
