/**
 * useNarrativeDiagnostics — Fetches unified narrative diagnostics via TanStack Query.
 * Fail-closed: returns null on error.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface NarrativeDiagnostic {
  diagnostic_id: string;
  project_id: string;
  source_system: string;
  severity: 'critical' | 'high' | 'warning' | 'info';
  /** Backend canonical name is scope_level; scope_type kept as alias for backward compat */
  scope_type: string;
  scope_level?: string;
  scope_key?: string;
  summary: string;
  details?: string | null;
  recommended_action?: string | null;
  created_at: string;
  // DX2 fields
  diagnostic_type?: string;
  affected_axes?: string[];
  affected_units?: string[];
  affected_entities?: string[];
  affected_beats?: string[];
  affected_relations?: string[];
  repairability?: 'auto' | 'guided' | 'manual' | 'unknown';
  base_severity?: string;
  load_class?: string;
  priority_score?: number;
  // DX3 convergence fields
  repair_id?: string | null;
  repair_status?: string | null;
  proposal_status?: string | null;
  resolution_state?: string | null;
  blocked_reason?: string | null;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

async function fetchDiagnostics(projectId: string): Promise<NarrativeDiagnostic[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Authentication required');

  const resp = await fetch(FUNC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action: 'get_narrative_diagnostics',
      projectId,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new Error(`Diagnostics failed: ${resp.status}${errBody ? ` — ${errBody}` : ''}`);
  }

  const result = await resp.json();
  if (!result?.ok || !Array.isArray(result?.diagnostics)) {
    throw new Error(result?.error ?? 'Diagnostics returned invalid response');
  }

  return result.diagnostics as NarrativeDiagnostic[];
}

export function useNarrativeDiagnostics(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ['narrative-diagnostics', projectId];

  const { data = null, isLoading, error: queryError } = useQuery({
    queryKey,
    queryFn: () => fetchDiagnostics(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const error = queryError ? (queryError as Error).message : null;

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey[1]]);

  return { data, isLoading, error, refresh };
}
