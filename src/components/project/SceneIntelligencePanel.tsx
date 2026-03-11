/**
 * SceneIntelligencePanel — Read-only NDG v1 graph intelligence panel.
 *
 * Renders only when ndg_project_graph returns ok: true.
 * Surfaces: graph summary, scene/axis coverage, scene/entity coverage,
 * entity relations, and risk surface.
 *
 * Fail-closed: renders nothing when graph unavailable.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Brain,
  Network,
  Users,
  AlertTriangle,
  Shield,
  Layers,
  ArrowRight,
} from 'lucide-react';
import {
  useNDGProjectGraph,
  type NDGNode,
  type NDGEdge,
  type NDGGraph,
  type NDGAtRiskScene,
} from '@/hooks/useNDGProjectGraph';

interface Props {
  projectId: string | undefined;
}

// ── Axis key → human label ──

const AXIS_LABELS: Record<string, string> = {
  story_engine:       'Story Engine',
  protagonist_arc:    'Protagonist Arc',
  antagonist_force:   'Antagonist Force',
  relationship_web:   'Relationship Web',
  world_logic:        'World Logic',
  thematic_premise:   'Thematic Premise',
  season_engine:      'Season Engine',
  tone_register:      'Tone Register',
  market_hook:        'Market Hook',
};

function axisLabel(key: string): string {
  return AXIS_LABELS[key] || key.replace(/_/g, ' ');
}

// ── Helpers ──

function groupEdgesByType(edges: NDGEdge[]) {
  const groups: Record<string, NDGEdge[]> = {};
  for (const e of edges) {
    (groups[e.edge_type] ||= []).push(e);
  }
  return groups;
}

function buildNodeMap(nodes: NDGNode[]): Map<string, NDGNode> {
  const map = new Map<string, NDGNode>();
  for (const n of nodes) map.set(n.node_id, n);
  return map;
}

export function SceneIntelligencePanel({ projectId }: Props) {
  const { data, isLoading } = useNDGProjectGraph(projectId);

  // Fail-closed: no projectId or loading
  if (!projectId) return null;

  if (isLoading) {
    return (
      <Card className="border-border/50 mt-4">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="h-4 w-4" /> Scene Intelligence
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Fail-closed: no data or engine returned not-ok
  if (!data || !data.ok || !data.graph) return null;

  const graph = data.graph;
  const nodeMap = buildNodeMap(graph.nodes);
  const edgeGroups = groupEdgesByType(graph.edges);

  const sceneAxisEdges    = edgeGroups['scene_linked_to_axis'] || [];
  const sceneEntityEdges  = edgeGroups['scene_contains_entity'] || [];
  const entityRelEdges    = edgeGroups['entity_relates_to_entity'] || [];
  const meta = graph.meta;

  return (
    <Card className="border-border/50 mt-4">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Scene Intelligence
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-auto">NDG v1</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* ── Graph Summary ── */}
        <GraphSummary meta={meta} />

        {/* ── Scene → Axis Coverage ── */}
        {sceneAxisEdges.length > 0 && (
          <SceneAxisCoverage edges={sceneAxisEdges} nodeMap={nodeMap} />
        )}

        {/* ── Scene → Entity Coverage ── */}
        {sceneEntityEdges.length > 0 && (
          <SceneEntityCoverage edges={sceneEntityEdges} nodeMap={nodeMap} />
        )}

        {/* ── Entity Relations ── */}
        {entityRelEdges.length > 0 && (
          <EntityRelations edges={entityRelEdges} nodeMap={nodeMap} />
        )}

        {/* ── Risk Surface ── */}
        <RiskSurface meta={meta} />
      </CardContent>
    </Card>
  );
}

// ── Sub-components ──

function GraphSummary({ meta }: { meta: NDGGraph['meta'] }) {
  const counts = meta.node_counts_by_type;
  const metrics = [
    { label: 'Scenes',    value: counts.scene || 0 },
    { label: 'Axes',      value: counts.spine_axis || 0 },
    { label: 'Entities',  value: counts.narrative_entity || 0 },
    { label: 'Units',     value: counts.narrative_unit || 0 },
    { label: 'Edges',     value: meta.edge_count },
  ];

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Layers className="h-3 w-3" /> Graph Summary
      </div>
      <div className="flex flex-wrap gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="flex items-center gap-1">
            <span className="text-sm font-semibold">{m.value}</span>
            <span className="text-[10px] text-muted-foreground">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneAxisCoverage({ edges, nodeMap }: { edges: NDGEdge[]; nodeMap: Map<string, NDGNode> }) {
  // Group by axis → scenes
  const axisScenesMap = new Map<string, string[]>();
  for (const e of edges) {
    const axisKey = e.to_id;
    const sceneNode = nodeMap.get(e.from_id);
    if (!sceneNode) continue;
    const list = axisScenesMap.get(axisKey) || [];
    list.push(sceneNode.label);
    axisScenesMap.set(axisKey, list);
  }

  const sorted = Array.from(axisScenesMap.entries()).sort((a, b) => b[1].length - a[1].length);

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Network className="h-3 w-3" /> Scene → Axis Coverage
      </div>
      <div className="space-y-1 max-h-36 overflow-y-auto">
        {sorted.slice(0, 12).map(([axisKey, scenes]) => (
          <div key={axisKey} className="flex items-center gap-1.5 text-[10px]">
            <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0">
              {axisLabel(axisKey)}
            </Badge>
            <span className="text-muted-foreground">
              {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneEntityCoverage({ edges, nodeMap }: { edges: NDGEdge[]; nodeMap: Map<string, NDGNode> }) {
  // Group by scene → entity count
  const sceneEntityCount = new Map<string, number>();
  for (const e of edges) {
    const sceneNode = nodeMap.get(e.from_id);
    if (!sceneNode) continue;
    sceneEntityCount.set(sceneNode.label, (sceneEntityCount.get(sceneNode.label) || 0) + 1);
  }

  const sorted = Array.from(sceneEntityCount.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Users className="h-3 w-3" /> Scene → Entity Coverage
      </div>
      <div className="space-y-1 max-h-36 overflow-y-auto">
        {sorted.slice(0, 10).map(([scene, count]) => (
          <div key={scene} className="flex items-center gap-1.5 text-[10px]">
            <span className="font-medium truncate max-w-[160px]">{scene}</span>
            <span className="text-muted-foreground">
              {count} entit{count !== 1 ? 'ies' : 'y'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntityRelations({ edges, nodeMap }: { edges: NDGEdge[]; nodeMap: Map<string, NDGNode> }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Network className="h-3 w-3" /> Entity Relations
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {edges.slice(0, 8).map((e) => {
          const from = nodeMap.get(e.from_id);
          const to   = nodeMap.get(e.to_id);
          if (!from || !to) return null;
          const relType = (e.meta?.relation_type as string || 'relates to').replace(/_/g, ' ');
          return (
            <div key={e.edge_id} className="flex items-center gap-1 text-[10px]">
              <span className="font-medium truncate max-w-[100px]">{from.label}</span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground italic shrink-0">{relType}</span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate max-w-[100px]">{to.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiskSurface({ meta }: { meta: NDGGraph['meta'] }) {
  const atRiskScenes = meta.at_risk_scenes || [];
  const atRiskAxes   = meta.at_risk_axes || [];

  if (atRiskScenes.length === 0 && atRiskAxes.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Shield className="h-3 w-3 text-emerald-500" />
        No active graph risk detected
      </div>
    );
  }

  return (
    <div>
      <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1.5">
        <AlertTriangle className="h-3 w-3" /> Risk Surface
        <Badge variant="outline" className="text-[8px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 ml-auto">
          {atRiskScenes.length} scene{atRiskScenes.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      {atRiskAxes.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {atRiskAxes.map((axis) => (
            <Badge key={axis} variant="outline" className="text-[8px] px-1.5 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400">
              {axisLabel(axis)}
            </Badge>
          ))}
        </div>
      )}

      {atRiskScenes.length > 0 && (
        <div className="space-y-1 max-h-28 overflow-y-auto">
          {atRiskScenes.slice(0, 8).map((s: NDGAtRiskScene, i: number) => (
            <div key={`${s.scene_key}-${i}`} className="flex items-center gap-1.5 text-[10px]">
              <span className="font-medium">{s.scene_key.replace(/_/g, ' ')}</span>
              <span className="text-muted-foreground">via {axisLabel(s.axis)}</span>
              <Badge
                variant="outline"
                className={`text-[7px] px-1 py-0 shrink-0 ${
                  s.risk_source === 'direct'
                    ? 'border-red-500/40 text-red-600 dark:text-red-400'
                    : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                }`}
              >
                {s.risk_source}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
