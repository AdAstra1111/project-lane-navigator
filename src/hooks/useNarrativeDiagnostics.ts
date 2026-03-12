/**
 * useNarrativeDiagnostics — Fetches unified narrative diagnostics.
 * Read-only. Fail-closed: returns null on error.
 */

import { useState, useCallback } from 'react';
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

export function useNarrativeDiagnostics(projectId: string | undefined) {
  const [data, setData] = useState<NarrativeDiagnostic[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;

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
          action: 'get_narrative_diagnostics',
          projectId,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        setError(`Diagnostics failed: ${resp.status}${errBody ? ` — ${errBody}` : ''}`);
        setData(null);
        setIsLoading(false);
        return;
      }

      const result = await resp.json();
      if (!result?.ok || !Array.isArray(result?.diagnostics)) {
        setError(result?.error ?? 'Diagnostics returned invalid response');
        setData(null);
        setIsLoading(false);
        return;
      }

      setData(result.diagnostics as NarrativeDiagnostic[]);
    } catch (e: any) {
      setError(e?.message ?? 'Diagnostics request failed');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  return { data, isLoading, error, refresh };
}
