/**
 * useNarrativeMonitor — Fetches canonical narrative monitoring state
 * from the get_autopilot_monitor_status engine action.
 *
 * Read-only. Computed-on-read. Never executes repairs.
 * Includes monitoring metadata (evaluated_at, derived_live, structural_uncertainty).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCallback } from 'react';
import type { AutopilotRepairPreview } from '@/hooks/useAutopilotRepairDetection';

export interface NarrativeMonitorStatus {
  project_id: string;
  action: string;
  ok: boolean;
  // Monitoring metadata
  monitoring_model: string;
  derived_live: boolean;
  evaluated_at: string;
  structural_uncertainty: boolean;
  // Health state
  autopilot_state: 'stable' | 'triggered' | 'unknown';
  trigger_reason: string | null;
  // Impact summary
  stale_unit_count: number;
  ndg_at_risk_count: number;
  recommended_scope: string | null;
  estimated_scene_count: number;
  repair_preview: AutopilotRepairPreview | null;
  execution_allowed: boolean;
  // Historical context
  last_run_at: string | null;
  last_run_confidence_band: string | null;
  last_run_scope: string | null;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export function useNarrativeMonitor(projectId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery<NarrativeMonitorStatus | null>({
    queryKey: ['autopilot-monitor-status', projectId],
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
          action: 'get_autopilot_monitor_status',
          projectId,
        }),
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data?.ok) return null;
      return data as NarrativeMonitorStatus;
    },
    enabled: !!projectId,
    staleTime: 60_000,
    retry: 1,
  });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['autopilot-monitor-status', projectId] });
  }, [queryClient, projectId]);

  return { ...query, refresh };
}
