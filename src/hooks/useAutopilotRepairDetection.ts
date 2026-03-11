/**
 * useAutopilotRepairDetection — Fetches autopilot narrative repair state
 * from the detect_autopilot_repair engine action.
 *
 * Read-only. Never executes repairs.
 * Supports manual refetch after repair runs complete.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCallback } from 'react';

export interface AutopilotRepairPreview {
  direct: number;
  propagated: number;
  entity_link: number;
  entity_propagation: number;
}

export interface AutopilotRepairDetection {
  project_id: string;
  action: string;
  ok: boolean;
  autopilot_state: 'stable' | 'triggered' | 'unknown';
  trigger_reason: string | null;
  stale_unit_count: number;
  ndg_at_risk_count: number;
  recommended_scope: string | null;
  estimated_scene_count: number;
  repair_preview: AutopilotRepairPreview | null;
  execution_allowed: boolean;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export function useAutopilotRepairDetection(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery<AutopilotRepairDetection | null>({
    queryKey: ['autopilot-repair-detection', projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const resp = await fetch(FUNC_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          action: 'detect_autopilot_repair',
          projectId,
        }),
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data?.ok) return null;
      return data as AutopilotRepairDetection;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['autopilot-repair-detection', projectId] });
  }, [queryClient, projectId]);

  return { ...query, refresh };
}
