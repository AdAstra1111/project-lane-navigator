/**
 * useExecuteNarrativeRepair — Executes a single narrative repair via backend.
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export interface RepairExecutionResult {
  ok: boolean;
  repair_id: string;
  repair_type: string;
  repairability: string;
  status: string;
  skipped_reason?: string;
  executed_at?: string;
  execution_result?: Record<string, unknown>;
  post_dx_diagnostic_present?: boolean;
  outcome_summary?: string;
  /** Structured blocked/prerequisite info from backend */
  blocked_reason?: string;
  prerequisite?: string;
}

export function useExecuteNarrativeRepair(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const [isExecuting, setIsExecuting] = useState(false);
  const [executingRepairId, setExecutingRepairId] = useState<string | null>(null);
  const [result, setResult] = useState<RepairExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (repairId: string, approved?: boolean) => {
    if (!projectId) return;
    setIsExecuting(true);
    setExecutingRepairId(repairId);
    setError(null);
    setResult(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Authentication required'); return; }

      const payload: Record<string, unknown> = {
        action: 'execute_narrative_repair',
        projectId,
        repair_id: repairId,
      };
      if (approved !== undefined) payload.approved = approved;

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        setError(`Execution failed: ${resp.status}${body ? ` — ${body}` : ''}`);
        return;
      }

      const json = await resp.json();
      setResult(json as RepairExecutionResult);

      // Invalidate queue, diagnostics, and story intelligence
      queryClient.invalidateQueries({ queryKey: ['narrative-repairs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['narrative-diagnostics', projectId] });
      queryClient.invalidateQueries({ queryKey: ['story-intelligence', projectId] });
      queryClient.invalidateQueries({ queryKey: ['narrative-stability', projectId] });
    } catch (e: any) {
      setError(e?.message ?? 'Execution request failed');
    } finally {
      setIsExecuting(false);
      setExecutingRepairId(null);
    }
  }, [projectId, queryClient]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setExecutingRepairId(null);
  }, []);

  return { execute, isExecuting, executingRepairId, result, error, reset };
}
