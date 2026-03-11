/**
 * useNDGProjectGraphSummary — Lightweight read-only hook for NDG summary data.
 *
 * Calls dev-engine-v2 action: ndg_project_graph with summaryOnly: true
 * Returns counts, at-risk data, and summary without full nodes/edges.
 * Fail-closed: returns null when projectId missing, auth missing, or engine errors.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { NDGNodeType, NDGEdgeType, NDGAtRiskScene } from './useNDGProjectGraph';

export interface NDGSummaryResponse {
  project_id:         string;
  action:             string;
  ok:                 boolean;
  summary_only:       true;
  node_count:         number;
  edge_count:         number;
  node_counts_by_type: Record<NDGNodeType, number>;
  edge_counts_by_type: Record<NDGEdgeType, number>;
  at_risk_scene_count: number;
  at_risk_axes:       string[];
  at_risk_scenes:     NDGAtRiskScene[];
  summary?:           Record<string, unknown>;
  diagnostic?:        string;
  note?:              string;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export function useNDGProjectGraphSummary(projectId: string | undefined) {
  return useQuery<NDGSummaryResponse | null>({
    queryKey: ['ndg-project-graph-summary', projectId],
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
          action: 'ndg_project_graph',
          projectId,
          summaryOnly: true,
        }),
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      if (!data?.ok) return null;
      return data as NDGSummaryResponse;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}
