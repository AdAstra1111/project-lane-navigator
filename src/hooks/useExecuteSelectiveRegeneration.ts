/**
 * useExecuteSelectiveRegeneration — Mutation hook for selective regeneration execution.
 *
 * Calls dev-engine-v2 action: execute_selective_regeneration
 * Supports dryRun and real execution modes.
 * Fail-closed: surfaces real abort reasons from engine.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface RegenExecutionResult {
  ok: boolean;
  run_id?: string;
  status?: 'completed' | 'partial_failure' | 'failed' | 'abort' | 'dry_run';
  abort_reason?: string;
  completed_scene_count?: number;
  failed_scene_count?: number;
  completed_scene_keys?: string[];
  failed_scene_keys?: string[];
  ndg_pre_at_risk_count?: number;
  ndg_post_at_risk_count?: number;
  ndg_validation_status?: string;
  nue_revalidated?: boolean;
  revalidated_unit_keys?: string[];
  aligned_unit_count?: number;
  rationale?: string;
  diagnostics?: string;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export function useExecuteSelectiveRegeneration(projectId: string | undefined) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<RegenExecutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (dryRun: boolean, repairStrategy: 'precision' | 'balanced' | 'stabilization' = 'balanced') => {
    if (!projectId) return null;

    setIsExecuting(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Authentication required');
        setIsExecuting(false);
        return null;
      }

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'execute_selective_regeneration',
          projectId,
          dryRun,
          repair_strategy: repairStrategy,
        }),
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => 'Execution request failed');
        setError(errText);
        setIsExecuting(false);
        return null;
      }

      const data = (await resp.json()) as RegenExecutionResult;
      setResult(data);
      setIsExecuting(false);
      return data;
    } catch (e: any) {
      setError(e?.message ?? 'Unknown execution error');
      setIsExecuting(false);
      return null;
    }
  }, [projectId]);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { execute, isExecuting, result, error, reset };
}
