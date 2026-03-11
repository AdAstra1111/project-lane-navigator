/**
 * SceneIntelligencePanel v1.1 — NDG v1 graph intelligence panel.
 * Renders only when ndg_project_graph returns ok: true.
 * Surfaces: graph summary, risk surface, scene/axis coverage,
 * scene/entity coverage, entity relations.
 * Supports slugline enrichment, filtering, and drill-downs.
 * Fail-closed: renders nothing when graph unavailable.
 */

import { useState, useMemo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Brain,
  Network,
  Users,
  AlertTriangle,
  Shield,
  Layers,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  useNDGProjectGraph,
  type NDGNode,
  type NDGEdge,
  type NDGGraph,
  type NDGAtRiskScene,
} from '@/hooks/useNDGProjectGraph';
import { useSceneSluglines, type SluglineMap } from '@/hooks/useSceneSluglines';

// ── Types ──

type FilterMode = 'all' | 'by_axis' | 'by_entity' | 'at_risk';

interface Props {
  projectId: string | undefined;
}

// ── Axis key → human label ──

const AXIS_LABELS: Record<string, string> = {
  story_engine: 'Story Engine',
  protagonist_arc: 'Protagonist Arc',
  antagonist_force: 'Antagonist Force',
  relationship_web: 'Relationship Web',
  world_logic: 'World Logic',
  thematic_premise: 'Thematic Premise',
  season_engine: 'Season Engine',
  tone_register: 'Tone Register',
  market_hook: 'Market Hook',
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

/** Resolve display label for a scene node: slugline if available, else node label. */
function sceneDisplayLabel(node: NDGNode, sluglines: SluglineMap): string {
  // Try node_id as scene_id lookup, then meta.scene_key
  const slugline =
    sluglines.get(node.node_id) ||
    sluglines.get(node.meta?.scene_key as string || '');
  if (slugline) {
    return `${node.label} — ${slugline}`;
  }
  return node.label;
}

function sceneKeyDisplayLabel(sceneKey: string, sluglines: SluglineMap): string {
  const slugline = sluglines.get(sceneKey);
  if (slugline) return `${sceneKey.replace(/_/g, ' ')} — ${slugline}`;
  return sceneKey.replace(/_/g, ' ');
}

const SHOW_MORE_THRESHOLD = 8;

// ── Main Component ──

export function SceneIntelligencePanel({ projectId }: Props) {
  const { data, isLoading } = useNDGProjectGraph(projectId);
  const { data: sluglines } = useSceneSluglines(projectId);
  const sluglineMap = sluglines || new Map<string, string>();

  const [filter, setFilter] = useState<FilterMode>('all');

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

  if (!data || !data.ok || !data.graph) return null;

  const graph = data.graph;
  const nodeMap = buildNodeMap(graph.nodes);
  const edgeGroups = groupEdgesByType(graph.edges);

  const sceneAxisEdges = edgeGroups['scene_linked_to_axis'] || [];
  const sceneEntityEdges = edgeGroups['scene_contains_entity'] || [];
  const entityRelEdges = edgeGroups['entity_relates_to_entity'] || [];
  const meta = graph.meta;
  const hasRisk = (meta.at_risk_scenes?.length || 0) > 0 || (meta.at_risk_axes?.length || 0) > 0;

  return (
    <Card className="border-border/50 mt-4">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Scene Intelligence
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 ml-auto">
            NDG v1.1
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* ── Filter Bar ── */}
        <FilterBar filter={filter} setFilter={setFilter} hasRisk={hasRisk} />

        {/* ── Graph Summary (always visible) ── */}
        {filter === 'all' && <GraphSummary meta={meta} />}

        {/* ── Risk Surface (priority position) ── */}
        {(filter === 'all' || filter === 'at_risk') && (
          <RiskSurface meta={meta} sluglines={sluglineMap} />
        )}

        {/* ── Scene → Axis Coverage ── */}
        {(filter === 'all' || filter === 'by_axis') && sceneAxisEdges.length > 0 && (
          <SceneAxisCoverage edges={sceneAxisEdges} nodeMap={nodeMap} sluglines={sluglineMap} />
        )}

        {/* ── Scene → Entity Coverage ── */}
        {(filter === 'all' || filter === 'by_entity') && sceneEntityEdges.length > 0 && (
          <SceneEntityCoverage
            edges={sceneEntityEdges}
            nodeMap={nodeMap}
            sluglines={sluglineMap}
          />
        )}

        {/* ── Entity Relations ── */}
        {(filter === 'all' || filter === 'by_entity') && entityRelEdges.length > 0 && (
          <EntityRelations edges={entityRelEdges} nodeMap={nodeMap} />
        )}
      </CardContent>
    </Card>
  );
}

// ── Filter Bar ──

function FilterBar({
  filter,
  setFilter,
  hasRisk,
}: {
  filter: FilterMode;
  setFilter: (f: FilterMode) => void;
  hasRisk: boolean;
}) {
  const filters: { key: FilterMode; label: string; show: boolean }[] = [
    { key: 'all', label: 'All', show: true },
    { key: 'by_axis', label: 'By Axis', show: true },
    { key: 'by_entity', label: 'By Entity', show: true },
    { key: 'at_risk', label: 'At Risk', show: hasRisk },
  ];

  return (
    <div className="flex items-center gap-1.5">
      <Filter className="h-3 w-3 text-muted-foreground shrink-0" />
      {filters
        .filter((f) => f.show)
        .map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              filter === f.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-transparent text-muted-foreground border-border/50 hover:border-border hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
    </div>
  );
}

// ── Sub-components ──

function GraphSummary({ meta }: { meta: NDGGraph['meta'] }) {
  const counts = meta.node_counts_by_type;
  const metrics = [
    { label: 'Scenes', value: counts.scene || 0 },
    { label: 'Axes', value: counts.spine_axis || 0 },
    { label: 'Entities', value: counts.narrative_entity || 0 },
    { label: 'Units', value: counts.narrative_unit || 0 },
    { label: 'Edges', value: meta.edge_count },
  ];

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Layers className="h-3 w-3" /> Graph Summary
      </div>
      <div className="flex flex-wrap gap-3">
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

function SceneAxisCoverage({
  edges,
  nodeMap,
  sluglines,
}: {
  edges: NDGEdge[];
  nodeMap: Map<string, NDGNode>;
  sluglines: SluglineMap;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Group by axis → scenes
  const axisScenesMap = useMemo(() => {
    const map = new Map<string, NDGNode[]>();
    for (const e of edges) {
      const axisKey = e.to_id;
      const sceneNode = nodeMap.get(e.from_id);
      if (!sceneNode) continue;
      const list = map.get(axisKey) || [];
      list.push(sceneNode);
      map.set(axisKey, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [edges, nodeMap]);

  const visible = showAll ? axisScenesMap : axisScenesMap.slice(0, SHOW_MORE_THRESHOLD);

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Network className="h-3 w-3" /> Scene → Axis Coverage
      </div>
      <div className="space-y-0.5 max-h-52 overflow-y-auto">
        {visible.map(([axisKey, scenes]) => (
          <Collapsible
            key={axisKey}
            open={expanded === axisKey}
            onOpenChange={(open) => setExpanded(open ? axisKey : null)}
          >
            <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] w-full py-0.5 px-1 rounded hover:bg-muted/50 transition-colors">
              {expanded === axisKey ? (
                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              )}
              <Badge variant="secondary" className="text-[8px] px-1 py-0 shrink-0">
                {axisLabel(axisKey)}
              </Badge>
              <span className="text-muted-foreground">
                {scenes.length} scene{scenes.length !== 1 ? 's' : ''}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-5 pl-2 border-l border-border/30 space-y-0.5 py-0.5">
                {scenes.map((s) => (
                  <div key={s.node_id} className="text-[9px] text-muted-foreground truncate">
                    {sceneDisplayLabel(s, sluglines)}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
      {axisScenesMap.length > SHOW_MORE_THRESHOLD && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[9px] text-primary hover:underline mt-1"
        >
          {showAll ? 'Show less' : `Show all ${axisScenesMap.length} axes`}
        </button>
      )}
    </div>
  );
}

function SceneEntityCoverage({
  edges,
  nodeMap,
  sluglines,
}: {
  edges: NDGEdge[];
  nodeMap: Map<string, NDGNode>;
  sluglines: SluglineMap;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Group by scene → entities
  const sceneEntities = useMemo(() => {
    const map = new Map<string, { scene: NDGNode; entities: NDGNode[] }>();
    for (const e of edges) {
      const sceneNode = nodeMap.get(e.from_id);
      const entityNode = nodeMap.get(e.to_id);
      if (!sceneNode || !entityNode) continue;
      const entry = map.get(sceneNode.node_id) || { scene: sceneNode, entities: [] };
      entry.entities.push(entityNode);
      map.set(sceneNode.node_id, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.entities.length - a.entities.length);
  }, [edges, nodeMap]);

  const visible = showAll ? sceneEntities : sceneEntities.slice(0, SHOW_MORE_THRESHOLD);

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Users className="h-3 w-3" /> Scene → Entity Coverage
      </div>
      <div className="space-y-0.5 max-h-52 overflow-y-auto">
        {visible.map(({ scene, entities }) => (
          <Collapsible
            key={scene.node_id}
            open={expanded === scene.node_id}
            onOpenChange={(open) => setExpanded(open ? scene.node_id : null)}
          >
            <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] w-full py-0.5 px-1 rounded hover:bg-muted/50 transition-colors">
              {expanded === scene.node_id ? (
                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              )}
              <span className="font-medium truncate max-w-[200px]">
                {sceneDisplayLabel(scene, sluglines)}
              </span>
              <span className="text-muted-foreground shrink-0">
                {entities.length} entit{entities.length !== 1 ? 'ies' : 'y'}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="ml-5 pl-2 border-l border-border/30 space-y-0.5 py-0.5">
                {entities.map((ent) => (
                  <div key={ent.node_id} className="text-[9px] text-muted-foreground flex items-center gap-1">
                    <span className="font-medium text-foreground">{ent.label}</span>
                    {ent.meta?.entity_type && (
                      <Badge variant="outline" className="text-[7px] px-1 py-0">
                        {String(ent.meta.entity_type).replace(/_/g, ' ')}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
      {sceneEntities.length > SHOW_MORE_THRESHOLD && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[9px] text-primary hover:underline mt-1"
        >
          {showAll ? 'Show less' : `Show all ${sceneEntities.length} scenes`}
        </button>
      )}
    </div>
  );
}

function EntityRelations({
  edges,
  nodeMap,
}: {
  edges: NDGEdge[];
  nodeMap: Map<string, NDGNode>;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? edges : edges.slice(0, SHOW_MORE_THRESHOLD);

  return (
    <div>
      <div className="text-[10px] font-medium text-muted-foreground flex items-center gap-1 mb-1.5">
        <Network className="h-3 w-3" /> Entity Relations
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {visible.map((e) => {
          const from = nodeMap.get(e.from_id);
          const to = nodeMap.get(e.to_id);
          if (!from || !to) return null;
          const relType = (
            (e.meta?.relation_type as string) || 'relates to'
          ).replace(/_/g, ' ');
          return (
            <div key={e.edge_id} className="flex items-center gap-1 text-[10px]">
              <span className="font-medium truncate max-w-[100px]">{from.label}</span>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0 italic">
                {relType}
              </Badge>
              <ArrowRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate max-w-[100px]">{to.label}</span>
            </div>
          );
        })}
      </div>
      {edges.length > SHOW_MORE_THRESHOLD && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="text-[9px] text-primary hover:underline mt-1"
        >
          {showAll ? 'Show less' : `Show all ${edges.length} relations`}
        </button>
      )}
    </div>
  );
}

function RiskSurface({
  meta,
  sluglines,
}: {
  meta: NDGGraph['meta'];
  sluglines: SluglineMap;
}) {
  const atRiskScenes = meta.at_risk_scenes || [];
  const atRiskAxes = meta.at_risk_axes || [];
  const [expanded, setExpanded] = useState<string | null>(null);

  if (atRiskScenes.length === 0 && atRiskAxes.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Shield className="h-3 w-3 text-emerald-500" />
        No active graph risk detected
      </div>
    );
  }

  // Group at-risk scenes by risk_source for clarity
  const directScenes = atRiskScenes.filter((s) => s.risk_source === 'direct');
  const propagatedScenes = atRiskScenes.filter((s) => s.risk_source === 'propagated');

  return (
    <div>
      <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1 mb-1.5">
        <AlertTriangle className="h-3 w-3" /> Risk Surface
        <div className="flex gap-1 ml-auto">
          {directScenes.length > 0 && (
            <Badge
              variant="outline"
              className="text-[8px] px-1 py-0 border-destructive/40 text-destructive"
            >
              {directScenes.length} direct
            </Badge>
          )}
          {propagatedScenes.length > 0 && (
            <Badge
              variant="outline"
              className="text-[8px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400"
            >
              {propagatedScenes.length} propagated
            </Badge>
          )}
        </div>
      </div>

      {atRiskAxes.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {atRiskAxes.map((axis) => (
            <Badge
              key={axis}
              variant="outline"
              className="text-[8px] px-1.5 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400"
            >
              {axisLabel(axis)}
            </Badge>
          ))}
        </div>
      )}

      {atRiskScenes.length > 0 && (
        <div className="space-y-0.5 max-h-36 overflow-y-auto">
          {atRiskScenes.slice(0, 12).map((s: NDGAtRiskScene, i: number) => (
            <Collapsible
              key={`${s.scene_key}-${i}`}
              open={expanded === `${s.scene_key}-${i}`}
              onOpenChange={(open) =>
                setExpanded(open ? `${s.scene_key}-${i}` : null)
              }
            >
              <CollapsibleTrigger className="flex items-center gap-1.5 text-[10px] w-full py-0.5 px-1 rounded hover:bg-muted/50 transition-colors">
                {expanded === `${s.scene_key}-${i}` ? (
                  <ChevronDown className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                )}
                <span className="font-medium truncate max-w-[140px]">
                  {sceneKeyDisplayLabel(s.scene_key, sluglines)}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[7px] px-1 py-0 shrink-0 ${
                    s.risk_source === 'direct'
                      ? 'border-destructive/40 text-destructive'
                      : 'border-amber-500/40 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {s.risk_source}
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="ml-5 pl-2 border-l border-border/30 py-1 space-y-0.5">
                  <div className="text-[9px] text-muted-foreground">
                    <span className="font-medium text-foreground">Axis:</span>{' '}
                    {axisLabel(s.axis)}
                  </div>
                  {s.reason && (
                    <div className="text-[9px] text-muted-foreground">
                      <span className="font-medium text-foreground">Reason:</span>{' '}
                      {s.reason}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      )}
    </div>
  );
}
