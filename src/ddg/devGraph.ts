/**
 * DDG — Deterministic Development Graph
 *
 * A structured graph overlay that describes each document stage as a node
 * with explicit inputs, canon policies, alignment rules, and quality gates.
 *
 * SHADOW MODE: DDG computes in parallel with the existing ladder system.
 * Its outputs are logged via IEL but do NOT drive pipeline decisions yet.
 *
 * Data source: supabase/_shared/stage-ladders.json (same canonical source
 * as registry.ts and pipeline-brain.ts — no drift).
 */

import {
  getLadderForFormat,
  normalizeFormatKey,
  mapDocTypeToLadderStage,
  FORMAT_LADDERS,
  type DeliverableStage,
} from '@/lib/stages/registry';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GraphNode {
  node_id: DeliverableStage;
  index: number;
  required_inputs: DeliverableStage[];
  canon_policy: 'source' | 'consumer' | 'structural' | 'none';
  alignment_policy: 'full' | 'partial' | 'exempt';
  quality_gate: 'ci_gp' | 'structural' | 'none';
}

export interface DDGState {
  format: string;
  formatKey: string;
  nodes: GraphNode[];
  ready_nodes: DeliverableStage[];
  blocked_nodes: DeliverableStage[];
  dirty_nodes: DeliverableStage[];
  next_nodes: DeliverableStage[];
}

// ── Canon Policy Registry ──────────────────────────────────────────────────────
// Defines whether each doc_type DEFINES canon, CONSUMES it, or is STRUCTURAL.

const CANON_SOURCES = new Set<string>([
  'character_bible', 'season_arc', 'format_rules', 'treatment',
  'story_outline', 'beat_sheet',
]);

const CANON_CONSUMERS = new Set<string>([
  'feature_script', 'episode_script', 'season_script',
  'season_master_script', 'production_draft',
]);

const STRUCTURAL_TYPES = new Set<string>([
  'episode_grid', 'vertical_episode_beats', 'episode_beats',
  'documentary_outline', 'deck',
]);

function getCanonPolicy(docType: string): GraphNode['canon_policy'] {
  if (CANON_SOURCES.has(docType)) return 'source';
  if (CANON_CONSUMERS.has(docType)) return 'consumer';
  if (STRUCTURAL_TYPES.has(docType)) return 'structural';
  return 'none';
}

// ── Alignment Policy Registry ──────────────────────────────────────────────────
// Maps to shouldRunCanonAlignment from doc-os.ts PAL.

const ALIGNMENT_FULL: Record<string, Set<string>> = {
  'film': new Set(['feature_script', 'production_draft']),
  'feature': new Set(['feature_script', 'production_draft']),
  'short': new Set(['feature_script']),
  'animation': new Set(['feature_script']),
  'tv-series': new Set(['episode_script', 'season_master_script', 'production_draft']),
  'limited-series': new Set(['episode_script', 'season_master_script', 'production_draft']),
  'digital-series': new Set(['episode_script', 'season_master_script', 'production_draft']),
  'anim-series': new Set(['episode_script', 'season_master_script', 'production_draft']),
  'vertical-drama': new Set(['season_script']),
  'reality': new Set(['episode_script']),
};

function getAlignmentPolicy(docType: string, formatKey: string): GraphNode['alignment_policy'] {
  const full = ALIGNMENT_FULL[formatKey];
  if (full?.has(docType)) return 'full';
  if (CANON_SOURCES.has(docType) || STRUCTURAL_TYPES.has(docType)) return 'exempt';
  return 'partial';
}

// ── Graph Construction ─────────────────────────────────────────────────────────

/**
 * Build the full development graph for a given format.
 * Each node's required_inputs is the preceding stage on the ladder.
 */
export function buildGraph(format: string): GraphNode[] {
  const formatKey = normalizeFormatKey(format);
  const ladder = getLadderForFormat(format);
  if (!ladder) {
    console.error(`[IEL] ddg_build_failed { format: "${format}", reason: "no_ladder" }`);
    return [];
  }

  return ladder.map((stage, index) => ({
    node_id: stage,
    index,
    required_inputs: index > 0 ? [ladder[index - 1]] : [],
    canon_policy: getCanonPolicy(stage),
    alignment_policy: getAlignmentPolicy(stage, formatKey),
    quality_gate: CANON_CONSUMERS.has(stage) ? 'ci_gp' : STRUCTURAL_TYPES.has(stage) ? 'structural' : 'none',
  }));
}

// ── Core Resolvers ─────────────────────────────────────────────────────────────

/**
 * Resolve the graph node for a given format + doc_type.
 * Returns null if the doc_type is not on the graph for this format.
 */
export function resolveStage(format: string, docType: string): GraphNode | null {
  const nodes = buildGraph(format);
  const mapped = mapDocTypeToLadderStage(docType);
  const node = nodes.find(n => n.node_id === mapped);
  if (node) {
    console.log(`[IEL] ddg_stage_resolved { format: "${format}", doc_type: "${docType}", node: "${node.node_id}", index: ${node.index} }`);
  }
  return node || null;
}

/**
 * Get the next available nodes after a given doc_type.
 * For a linear ladder, this is always the single next stage.
 * Future: could return multiple if graph has branches.
 */
export function getNextNodes(format: string, docType: string): GraphNode[] {
  const nodes = buildGraph(format);
  const mapped = mapDocTypeToLadderStage(docType);
  const currentIdx = nodes.findIndex(n => n.node_id === mapped);
  if (currentIdx < 0 || currentIdx >= nodes.length - 1) return [];
  return [nodes[currentIdx + 1]];
}

/**
 * Validate that a promotion from one doc_type to another is valid in the graph.
 * Adjacent-only promotion (mirrors registry.ts validatePromotion).
 */
export function validatePromotion(
  format: string,
  fromDoc: string,
  toDoc: string,
): { valid: boolean; reason: string } {
  const nodes = buildGraph(format);
  const fromMapped = mapDocTypeToLadderStage(fromDoc);
  const toMapped = mapDocTypeToLadderStage(toDoc);

  const fromIdx = nodes.findIndex(n => n.node_id === fromMapped);
  const toIdx = nodes.findIndex(n => n.node_id === toMapped);

  if (fromIdx < 0) return { valid: false, reason: `"${fromDoc}" not on graph for ${format}` };
  if (toIdx < 0) return { valid: false, reason: `"${toDoc}" not on graph for ${format}` };
  if (toIdx !== fromIdx + 1) {
    return { valid: false, reason: `Non-adjacent: ${fromMapped}[${fromIdx}] → ${toMapped}[${toIdx}]` };
  }
  return { valid: true, reason: 'Adjacent promotion' };
}

/**
 * Determine if canon alignment should run for this format + doc_type.
 * Mirrors shouldRunCanonAlignment from doc-os.ts PAL.
 */
export function shouldRunCanonAlignment(format: string, docType: string): boolean {
  const formatKey = normalizeFormatKey(format);
  const full = ALIGNMENT_FULL[formatKey];
  return full?.has(docType) ?? false;
}

/**
 * Compute which nodes are "dirty" (potentially affected) by a change to a given node.
 * In a linear graph, all downstream nodes are dirty.
 */
export function computeDirtyNodes(format: string, changedNodeId: string): DeliverableStage[] {
  const nodes = buildGraph(format);
  const mapped = mapDocTypeToLadderStage(changedNodeId);
  const idx = nodes.findIndex(n => n.node_id === mapped);
  if (idx < 0) return [];
  return nodes.slice(idx + 1).map(n => n.node_id);
}

// ── State Computation ──────────────────────────────────────────────────────────

/**
 * Compute the full DDG state for a project given existing documents.
 */
export function computeDDGState(
  format: string,
  existingDocTypes: string[],
): DDGState {
  const formatKey = normalizeFormatKey(format);
  const nodes = buildGraph(format);

  const existingSet = new Set(existingDocTypes.map(dt => mapDocTypeToLadderStage(dt)));

  const readyNodes: DeliverableStage[] = [];
  const blockedNodes: DeliverableStage[] = [];
  const nextNodes: DeliverableStage[] = [];

  for (const node of nodes) {
    if (existingSet.has(node.node_id)) continue; // Already exists

    const inputsMet = node.required_inputs.every(inp => existingSet.has(inp));
    if (inputsMet) {
      readyNodes.push(node.node_id);
      if (nextNodes.length === 0) nextNodes.push(node.node_id); // First ready = next
    } else {
      blockedNodes.push(node.node_id);
    }
  }

  console.log(`[IEL] ddg_plan_computed { format: "${formatKey}", ready: [${readyNodes.join(',')}], blocked: [${blockedNodes.join(',')}], next: [${nextNodes.join(',')}] }`);

  return {
    format,
    formatKey,
    nodes,
    ready_nodes: readyNodes,
    blocked_nodes: blockedNodes,
    dirty_nodes: [], // Computed on-demand via computeDirtyNodes
    next_nodes: nextNodes,
  };
}
