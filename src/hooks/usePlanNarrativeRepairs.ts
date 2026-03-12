/**
 * usePlanNarrativeRepairs — Triggers plan_narrative_repairs backend action.
 */

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export function usePlanNarrativeRepairs(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const [isPlanning, setIsPlanning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const planRepairs = useCallback(async () => {
    if (!projectId) return;
    setIsPlanning(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Authentication required'); return; }

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action: 'plan_narrative_repairs', projectId }),
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        setError(`Plan failed: ${resp.status}${body ? ` — ${body}` : ''}`);
        return;
      }

      const json = await resp.json();
      if (!json?.ok) {
        setError(json?.error ?? 'Plan returned invalid response');
        return;
      }

      setResult(json);
      queryClient.invalidateQueries({ queryKey: ['narrative-repairs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['narrative-diagnostics', projectId] });
    } catch (e: any) {
      setError(e?.message ?? 'Plan request failed');
    } finally {
      setIsPlanning(false);
    }
  }, [projectId, queryClient]);

  return { planRepairs, isPlanning, result, error };
}
