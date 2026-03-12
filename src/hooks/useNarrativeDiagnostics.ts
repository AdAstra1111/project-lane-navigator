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
  scope_type: string;
  scope_key?: string;
  summary: string;
  details?: string;
  recommended_action?: string;
  created_at: string;
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
