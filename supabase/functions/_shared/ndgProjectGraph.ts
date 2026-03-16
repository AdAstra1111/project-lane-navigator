/**
 * NDG v1 — Unified Narrative Dependency Graph (Project Layer)
 *
 * Pure TypeScript projection layer over existing DB surfaces.
 * Read-only. No DB queries. No AI inference. No schema drift.
 *
 * ────────────────────────────────────────────────────────────────
 * LAYER POSITION:
 *
 *   Canon → Spine → Entities → Narrative Units → Scenes
 *     → NDG (THIS MODULE)
 *       → Rewrite Planning / Scene Risk / UI consumers
 *
 * This module receives pre-loaded raw data and projects it
 * into a unified node/edge graph. It does not query the DB directly.
 *
 * ────────────────────────────────────────────────────────────────
 * NODE TYPES (4):
 *
 *   spine_axis     — virtual: 9 canonical axes from SPINE_AXES
 *   narrative_unit — from narrative_units; anchored by unit_key
 *   narrative_entity — from narrative_entities; anchored by entity_key
 *   scene          — from scene_graph_scenes; anchored by scene_key
 *
 * EDGE TYPES (6 deterministic):
 *
 *   axis_downstream_of_axis  — from NARRATIVE_DEPENDENCY_EDGES (canonical registry, 10 edges)
 *   unit_covers_axis         — unit.unit_type = axis_key (field mapping, deterministic)
 *   entity_relates_to_entity — from narrative_entity_relations (explicit DB relation)
 *   scene_linked_to_axis     — from scene_spine_links (explicit DB link, axis_key field)
 *   scene_contains_entity    — from narrative_scene_entity_links (explicit DB link)
 *   unit_impacts_scene       — derived: stale/contradicted unit → axis → scenes at that axis
 *                              (NDG propagation + scene_spine_links lookup)
 *
 * ────────────────────────────────────────────────────────────────
 * IDENTITY SAFETY:
 *   All node IDs anchor to stable system keys:
 *   - spine_axis: axis_key (e.g. "story_engine")
 *   - narrative_unit: unit_key (e.g. "ebc4b926::protagonist_arc")
 *   - narrative_entity: entity_key (e.g. "CHAR_ELARA_VANCE")
 *   - scene: scene_key (e.g. "SCENE_001")
 *
 * DETERMINISM:
 *   Same input data → same graph. All edges derived from explicit
 *   DB fields or canonical registry. No fuzzy inference.
 *
 * FAIL-CLOSED:
 *   Any edge that cannot be grounded in evidence is not emitted.
 *   Missing axis_key, entity_key, or scene_key → edge skipped.
 */

import {
  NARRATIVE_DEPENDENCY_EDGES,
  getDownstreamAxes,
  type SceneImpactEntry,
} from "./narrativeDependencyGraph.ts";
import { SPINE_AXES, AXIS_METADATA, type SpineAxis } from "./narrativeSpine.ts";
import { getSectionConfig, type SectionDefinition } from "./deliverableSectionRegistry.ts";

// ── Input types (raw DB rows) ──────────────────────────────────────────────

export interface NarrativeUnitRow {
  id: string;
  unit_key: string;
  unit_type: string;
  status: "active" | "aligned" | "contradicted" | "stale";
  payload_json: Record<string, unknown>;
  source_doc_type: string;
  source_doc_version_id: string | null;
  confidence: number;
}

export interface NarrativeEntityRow {
  id: string;
  entity_key: string;
  canonical_name: string;
  entity_type: string;
  source_kind: string;
  status: string;
}

export interface EntityRelationRow {
  id: string;
  source_entity_id: string;
  target_entity_id: string | null;
  relation_type: string;
  source_kind: string;
}

export interface SceneSpineLinkRow {
  scene_id: string;
  axis_key: string | null;
  scene_key?: string | null;
}

export interface SceneEntityLinkRow {
  scene_id: string;
  entity_id: string;
  relation_type: string;
  confidence: string;
  scene_key?: string | null;
}

export interface SceneRow {
  id: string;
  scene_key: string;
  deprecated_at: string | null;
}

export interface NDGInputData {
  narrative_units:   NarrativeUnitRow[];
  narrative_entities: NarrativeEntityRow[];
  entity_relations:  EntityRelationRow[];
  scene_spine_links: SceneSpineLinkRow[];
  scene_entity_links: SceneEntityLinkRow[];
  scenes:            SceneRow[];
}

// ── Output types ───────────────────────────────────────────────────────────

export type NDGNodeType = "spine_axis" | "narrative_unit" | "narrative_entity" | "scene";

export interface NDGNode {
  /** Stable system key (axis_key / unit_key / entity_key / scene_key) */
  node_id:    string;
  node_type:  NDGNodeType;
  /** Human-readable label */
  label:      string;
  /** Rich metadata for consumers */
  meta:       Record<string, unknown>;
}

export type NDGEdgeType =
  | "axis_downstream_of_axis"
  | "unit_covers_axis"
  | "entity_relates_to_entity"
  | "scene_linked_to_axis"
  | "scene_contains_entity"
  | "unit_impacts_scene";

export interface NDGEdge {
  /** Unique deterministic edge ID: "{type}:{from}→{to}" */
  edge_id:    string;
  edge_type:  NDGEdgeType;
  from_id:    string;
  to_id:      string;
  /** How this edge was derived */
  derivation: "canonical_registry" | "unit_type_field" | "db_relation" | "db_spine_link" | "db_entity_link" | "ndg_propagation";
  /** Optional edge metadata */
  meta:       Record<string, unknown>;
}

export interface NDGGraphMeta {
  node_count:          number;
  edge_count:          number;
  node_counts_by_type: Record<NDGNodeType, number>;
  edge_counts_by_type: Record<NDGEdgeType, number>;
  /** Number of scenes impacted by stale/contradicted units via NDG propagation */
  at_risk_scene_count: number;
  /** Axes that are stale or contradicted */
  at_risk_axes:        string[];
  /** Scenes at risk with scene_key + reason */
  at_risk_scenes:      Array<{ scene_key: string; axis: string; reason: string; risk_source: "direct" | "propagated" }>;
}

export interface NDGGraph {
  nodes: NDGNode[];
  edges: NDGEdge[];
  meta:  NDGGraphMeta;
}

// ── Graph Builder ──────────────────────────────────────────────────────────

/**
 * Builds the full NDG v1 project graph from pre-loaded raw data.
 *
 * Pure function — no side effects, no DB access, no AI inference.
 * Deterministic: same input → same output.
 */
export function buildNDGProjectGraph(data: NDGInputData): NDGGraph {
  const nodes: NDGNode[] = [];
  const edges: NDGEdge[] = [];

  // ── Node Layer 1: spine_axis (virtual, from registry) ─────────────────
  const axisNodeIds = new Set<string>();
  for (const axis of SPINE_AXES) {
    const meta = AXIS_METADATA[axis];
    nodes.push({
      node_id:   axis,
      node_type: "spine_axis",
      label:     meta.label,
      meta: {
        class:       meta.class,
        severity:    meta.severity,
        description: meta.description,
      },
    });
    axisNodeIds.add(axis);
  }

  // ── Node Layer 2: narrative_unit ───────────────────────────────────────
  const unitNodeIds = new Set<string>();
  const unitAxisMap = new Map<string, string>(); // unit_key → axis (unit_type)
  for (const unit of data.narrative_units) {
    const axisValue = unit.unit_type; // e.g. "protagonist_arc"
    nodes.push({
      node_id:   unit.unit_key,
      node_type: "narrative_unit",
      label:     `${axisValue} (${unit.source_doc_type})`,
      meta: {
        unit_type:             unit.unit_type,
        status:                unit.status,
        confidence:            unit.confidence,
        source_doc_type:       unit.source_doc_type,
        source_doc_version_id: unit.source_doc_version_id,
        spine_value:           unit.payload_json?.spine_value ?? null,
        verbatim_verified:     unit.payload_json?.verbatim_quote_verified ?? null,
        contradiction_note:    unit.payload_json?.contradiction_note ?? null,
        at_risk:               unit.status === "stale" || unit.status === "contradicted",
      },
    });
    unitNodeIds.add(unit.unit_key);
    unitAxisMap.set(unit.unit_key, axisValue);
  }

  // ── Node Layer 3: narrative_entity ────────────────────────────────────
  const entityNodeIds = new Set<string>();
  const entityIdToKey = new Map<string, string>(); // db id → entity_key
  for (const entity of data.narrative_entities) {
    nodes.push({
      node_id:   entity.entity_key,
      node_type: "narrative_entity",
      label:     entity.canonical_name,
      meta: {
        entity_type:    entity.entity_type,
        source_kind:    entity.source_kind,
        status:         entity.status,
      },
    });
    entityNodeIds.add(entity.entity_key);
    entityIdToKey.set(entity.id, entity.entity_key);
  }

  // ── Node Layer 4: scene ───────────────────────────────────────────────
  // Only include active (non-deprecated) scenes
  const sceneNodeIds = new Set<string>();
  const sceneIdToKey = new Map<string, string>(); // db id → scene_key
  for (const scene of data.scenes) {
    if (scene.deprecated_at) continue;
    nodes.push({
      node_id:   scene.scene_key,
      node_type: "scene",
      label:     scene.scene_key,
      meta:      { scene_id: scene.id },
    });
    sceneNodeIds.add(scene.scene_key);
    sceneIdToKey.set(scene.id, scene.scene_key);
  }
  // Also map from scene_spine_links rows that carry scene_key directly
  for (const link of data.scene_spine_links) {
    if (link.scene_key && !sceneIdToKey.has(link.scene_id)) {
      sceneIdToKey.set(link.scene_id, link.scene_key);
    }
  }
  for (const link of data.scene_entity_links) {
    if (link.scene_key && !sceneIdToKey.has(link.scene_id)) {
      sceneIdToKey.set(link.scene_id, link.scene_key);
    }
  }

  // ── Edge Type 1: axis_downstream_of_axis (canonical registry) ─────────
  for (const dep of NARRATIVE_DEPENDENCY_EDGES) {
    if (!axisNodeIds.has(dep.from) || !axisNodeIds.has(dep.to)) continue;
    edges.push({
      edge_id:    `axis_downstream_of_axis:${dep.from}→${dep.to}`,
      edge_type:  "axis_downstream_of_axis",
      from_id:    dep.from,
      to_id:      dep.to,
      derivation: "canonical_registry",
      meta: {
        dependency_type: dep.dependency_type,
        note:            dep.note,
      },
    });
  }

  // ── Edge Type 2: unit_covers_axis (unit_type field mapping) ───────────
  for (const unit of data.narrative_units) {
    const axis = unit.unit_type as SpineAxis;
    if (!axisNodeIds.has(axis)) continue; // axis not in registry → skip
    if (!unitNodeIds.has(unit.unit_key)) continue;
    edges.push({
      edge_id:    `unit_covers_axis:${unit.unit_key}→${axis}`,
      edge_type:  "unit_covers_axis",
      from_id:    unit.unit_key,
      to_id:      axis,
      derivation: "unit_type_field",
      meta: {
        status: unit.status,
        source_doc_type: unit.source_doc_type,
      },
    });
  }

  // ── Edge Type 3: entity_relates_to_entity (narrative_entity_relations) ─
  for (const rel of data.entity_relations) {
    const fromKey = entityIdToKey.get(rel.source_entity_id);
    const toKey   = rel.target_entity_id ? entityIdToKey.get(rel.target_entity_id) : null;
    if (!fromKey || !entityNodeIds.has(fromKey)) continue;
    if (toKey && !entityNodeIds.has(toKey)) continue;
    edges.push({
      edge_id:    `entity_relates_to_entity:${fromKey}→${toKey ?? "null"}`,
      edge_type:  "entity_relates_to_entity",
      from_id:    fromKey,
      to_id:      toKey ?? fromKey, // self-reference if no target (e.g. drives_arc)
      derivation: "db_relation",
      meta: {
        relation_type: rel.relation_type,
        source_kind:   rel.source_kind,
      },
    });
  }

  // ── Edge Type 4: scene_linked_to_axis (scene_spine_links) ─────────────
  for (const link of data.scene_spine_links) {
    if (!link.axis_key) continue;
    const sceneKey = sceneIdToKey.get(link.scene_id) ?? link.scene_key;
    if (!sceneKey || !axisNodeIds.has(link.axis_key as SpineAxis)) continue;
    edges.push({
      edge_id:    `scene_linked_to_axis:${sceneKey}→${link.axis_key}`,
      edge_type:  "scene_linked_to_axis",
      from_id:    sceneKey,
      to_id:      link.axis_key,
      derivation: "db_spine_link",
      meta:       {},
    });
  }

  // ── Edge Type 5: scene_contains_entity (narrative_scene_entity_links) ──
  const seenEntityEdges = new Set<string>();
  for (const link of data.scene_entity_links) {
    const sceneKey  = sceneIdToKey.get(link.scene_id) ?? link.scene_key;
    const entityKey = entityIdToKey.get(link.entity_id);
    if (!sceneKey || !entityKey) continue;
    if (!entityNodeIds.has(entityKey)) continue;
    const edgeId = `scene_contains_entity:${sceneKey}→${entityKey}`;
    if (seenEntityEdges.has(edgeId)) continue; // dedupe
    seenEntityEdges.add(edgeId);
    edges.push({
      edge_id:    edgeId,
      edge_type:  "scene_contains_entity",
      from_id:    sceneKey,
      to_id:      entityKey,
      derivation: "db_entity_link",
      meta: {
        relation_type: link.relation_type,
        confidence:    link.confidence,
      },
    });
  }

  // ── Edge Type 6: unit_impacts_scene (NDG propagation — derived) ────────
  // For stale/contradicted units: unit → affected downstream axes → scenes
  const atRiskUnitRows = data.narrative_units.filter(
    u => u.status === "stale" || u.status === "contradicted"
  );

  // Build axis → scene_key[] map from scene_spine_links
  const axisToSceneKeys = new Map<string, string[]>();
  for (const link of data.scene_spine_links) {
    if (!link.axis_key) continue;
    const sk = sceneIdToKey.get(link.scene_id) ?? link.scene_key;
    if (!sk) continue;
    if (!axisToSceneKeys.has(link.axis_key)) axisToSceneKeys.set(link.axis_key, []);
    axisToSceneKeys.get(link.axis_key)!.push(sk);
  }

  const atRiskScenes: NDGGraphMeta["at_risk_scenes"] = [];
  const atRiskAxesSeen = new Set<string>();
  const impactEdgeSeen = new Set<string>();

  for (const unit of atRiskUnitRows) {
    const directAxis = unit.unit_type;
    const reason = unit.status === "contradicted"
      ? (unit.payload_json?.contradiction_note as string || "contradiction detected")
      : "stale — needs revalidation";

    // Direct: scenes linked to this axis
    const directScenes = axisToSceneKeys.get(directAxis) ?? [];
    for (const sk of directScenes) {
      atRiskAxesSeen.add(directAxis);
      const existing = atRiskScenes.find(r => r.scene_key === sk);
      if (!existing) {
        atRiskScenes.push({ scene_key: sk, axis: directAxis, reason, risk_source: "direct" });
      }
      const edgeId = `unit_impacts_scene:${unit.unit_key}→${sk}`;
      if (!impactEdgeSeen.has(edgeId)) {
        impactEdgeSeen.add(edgeId);
        edges.push({
          edge_id:    edgeId,
          edge_type:  "unit_impacts_scene",
          from_id:    unit.unit_key,
          to_id:      sk,
          derivation: "ndg_propagation",
          meta: { risk_source: "direct", axis: directAxis, reason },
        });
      }
    }

    // Propagated: downstream axes of the direct axis
    const downstreamAxes = getDownstreamAxes(directAxis as SpineAxis);
    for (const downAxis of downstreamAxes) {
      const propagatedScenes = axisToSceneKeys.get(downAxis) ?? [];
      for (const sk of propagatedScenes) {
        atRiskAxesSeen.add(downAxis);
        const propagatedReason = `downstream of ${directAxis} (${reason})`;
        const existing = atRiskScenes.find(r => r.scene_key === sk);
        if (!existing) {
          atRiskScenes.push({ scene_key: sk, axis: downAxis, reason: propagatedReason, risk_source: "propagated" });
        }
        const edgeId = `unit_impacts_scene:${unit.unit_key}→${sk}(propagated)`;
        if (!impactEdgeSeen.has(edgeId)) {
          impactEdgeSeen.add(edgeId);
          edges.push({
            edge_id:    edgeId,
            edge_type:  "unit_impacts_scene",
            from_id:    unit.unit_key,
            to_id:      sk,
            derivation: "ndg_propagation",
            meta: { risk_source: "propagated", via_axis: downAxis, source_axis: directAxis, reason: propagatedReason },
          });
        }
      }
    }
  }

  // ── Assemble meta ──────────────────────────────────────────────────────
  const nodeCountsByType = {} as Record<NDGNodeType, number>;
  for (const n of nodes) {
    nodeCountsByType[n.node_type] = (nodeCountsByType[n.node_type] ?? 0) + 1;
  }

  const edgeCountsByType = {} as Record<NDGEdgeType, number>;
  for (const e of edges) {
    edgeCountsByType[e.edge_type] = (edgeCountsByType[e.edge_type] ?? 0) + 1;
  }

  atRiskScenes.sort((a, b) => a.scene_key.localeCompare(b.scene_key));

  const meta: NDGGraphMeta = {
    node_count:          nodes.length,
    edge_count:          edges.length,
    node_counts_by_type: nodeCountsByType,
    edge_counts_by_type: edgeCountsByType,
    at_risk_scene_count: atRiskScenes.length,
    at_risk_axes:        [...atRiskAxesSeen],
    at_risk_scenes:      atRiskScenes,
  };

  return { nodes, edges, meta };
}

/**
 * Returns a compact diagnostic summary of the graph (for logging / API response).
 * Does not include the full node/edge arrays.
 */
export function summariseNDGGraph(graph: NDGGraph): Record<string, unknown> {
  return {
    node_count:          graph.meta.node_count,
    edge_count:          graph.meta.edge_count,
    node_counts_by_type: graph.meta.node_counts_by_type,
    edge_counts_by_type: graph.meta.edge_counts_by_type,
    at_risk_scene_count: graph.meta.at_risk_scene_count,
    at_risk_axes:        graph.meta.at_risk_axes,
    at_risk_scenes:      graph.meta.at_risk_scenes,
  };
}
