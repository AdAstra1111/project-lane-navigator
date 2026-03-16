/**
 * useNDGProjectGraph — Read-only hook for fetching the NDG v1 project graph.
 *
 * Calls dev-engine-v2 action: ndg_project_graph
 * Returns the full graph payload (nodes, edges, meta, summary).
 * Fail-closed: returns null when projectId missing, auth missing, or engine errors.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// ── Types mirroring backend NDGGraph output ──

export type NDGNodeType = 'spine_axis' | 'narrative_unit' | 'narrative_entity' | 'scene' | 'section';

export type NDGEdgeType =
  | 'axis_downstream_of_axis'
  | 'unit_covers_axis'
  | 'entity_relates_to_entity'
  | 'scene_linked_to_axis'
  | 'scene_contains_entity'
  | 'unit_impacts_scene';

export interface NDGNode {
  node_id:   string;
  node_type: NDGNodeType;
  label:     string;
  meta:      Record<string, unknown>;
}

export interface NDGEdge {
  edge_id:    string;
  edge_type:  NDGEdgeType;
  from_id:    string;
  to_id:      string;
  derivation: string;
  meta:       Record<string, unknown>;
}

export interface NDGAtRiskScene {
  scene_key:   string;
  axis:        string;
  reason:      string;
  risk_source: 'direct' | 'propagated';
}

export interface NDGGraphMeta {
  node_count:          number;
  edge_count:          number;
  node_counts_by_type: Record<NDGNodeType, number>;
  edge_counts_by_type: Record<NDGEdgeType, number>;
  at_risk_scene_count: number;
  at_risk_axes:        string[];
  at_risk_scenes:      NDGAtRiskScene[];
}

export interface NDGGraph {
  nodes: NDGNode[];
  edges: NDGEdge[];
  meta:  NDGGraphMeta;
}

export interface NDGProjectGraphResponse {
  project_id: string;
  action:     string;
  ok:         boolean;
  node_count?: number;
  edge_count?: number;
  summary?:   Record<string, unknown>;
  graph?:     NDGGraph;
  diagnostic?: string;
  note?:      string;
}

const FUNC_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dev-engine-v2`;

export function useNDGProjectGraph(projectId: string | undefined) {
  return useQuery<NDGProjectGraphResponse | null>({
    queryKey: ['ndg-project-graph', projectId],
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
        body: JSON.stringify({ action: 'ndg_project_graph', projectId }),
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      return data as NDGProjectGraphResponse;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000, // 5 min cache
    retry: 1,
  });
}
