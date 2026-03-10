/**
 * Narrative Dependency Graph — NDG v1
 *
 * Canonical deterministic dependency registry over the 9 spine axes.
 * Read-only. No AI inference. No schema dependencies. No DB queries.
 *
 * Purpose:
 *   Answer: "If axis X changes, what other axes are structurally downstream
 *   and therefore at risk?"
 *
 * Architecture decision: runtime-only registry-driven (Option A).
 *   - Edges are deterministic and canonical — they do not vary by project
 *   - O(9) traversal = effectively O(1)
 *   - No schema migration required
 *   - Follows the same pattern as deliverableDependencyRegistry.ts
 *   - A persisted table would only be warranted for learned/per-project edges
 *     (out of scope for NDG v1)
 *
 * Dependency types:
 *   structural    — the upstream axis type determines what values are
 *                   coherent for the downstream axis
 *   causal        — the upstream axis mechanism drives or causes the
 *                   downstream axis to manifest in a particular way
 *   resolutional  — the upstream axis constrains the valid end-state
 *                   of the downstream axis
 *
 * All edges are confidence: 'canonical' — derived from structural narrative
 * theory, not document inference.
 *
 * NDG v1 scope:
 *   Covered axes: story_engine, pressure_system, central_conflict,
 *     protagonist_arc, resolution_type, stakes_class,
 *     inciting_incident, midpoint_reversal
 *   Excluded:     tonal_gravity (class C / expressive — not structural)
 */

import { type SpineAxis, type AmendmentSeverity, AXIS_METADATA } from "./narrativeSpine.ts";

// ── Types ────────────────────────────────────────────────────────────────

export type NDGDependencyType = "structural" | "causal" | "resolutional";

export interface NarrativeDependencyEdge {
  /** Upstream axis — the axis that, when changed, puts the downstream at risk */
  from: SpineAxis;
  /** Downstream axis — the axis structurally dependent on 'from' */
  to: SpineAxis;
  /** Nature of the dependency relationship */
  dependency_type: NDGDependencyType;
  /** All NDG v1 edges are canonical (deterministic, not inferred) */
  confidence: "canonical";
  /** Human-readable rationale for this edge */
  note: string;
}

// ── NDG v2: Risk Scoring ──────────────────────────────────────────────────

/**
 * Numeric severity weights for risk score calculation.
 * Maps IFFY's 5-tier AmendmentSeverity scale to integer weights.
 * Matches the canonical class hierarchy: Class A axes score higher than Class B.
 *
 *   constitutional (Class A) → 5
 *   severe         (Class B) → 4
 *   severe_moderate (Class B)→ 3
 *   moderate       (Class B/S)→ 2
 *   light          (Class C) → 1
 */
export const SEVERITY_WEIGHTS: Record<AmendmentSeverity, number> = {
  constitutional:  5,
  severe:          4,
  severe_moderate: 3,
  moderate:        2,
  light:           1,
};

/**
 * Unit confidence metadata subset used for risk scoring.
 * Derived from narrative_units.payload_json — all fields optional/nullable.
 */
export interface UnitConfidenceMeta {
  verbatim_quote?: string | null;
  verbatim_quote_verified?: boolean | null;
  verbatim_quote_match_section_key?: string | null;
  evidence_excerpt?: string | null;
}

/**
 * Risk score for a single source→target dependency edge.
 * Deterministic and reproducible given the same inputs.
 */
export interface AxisRiskScore {
  source_axis: SpineAxis;
  target_axis: SpineAxis;
  dependency_chain: SpineAxis[];
  severity_weight: number;
  distance: number;
  distance_weight: number;
  confidence_factor: number;
  risk_score: number;
}

export interface DownstreamRisk {
  axis: SpineAxis;
  dependency_chain: SpineAxis[];
  dependency_type: NDGDependencyType;
}

export interface PropagatedRisk {
  source_axis: SpineAxis;
  downstream_axes: SpineAxis[];
  dependency_chains: SpineAxis[][];
  reason: "canonical_dependency";
}

// ── Canonical Dependency Registry ────────────────────────────────────────
//
// Graph structure (acyclic):
//
//   story_engine ──structural──► pressure_system
//                ──structural──► central_conflict
//                ──causal──────► inciting_incident
//
//   pressure_system ──causal──────► protagonist_arc
//                   ──causal──────► stakes_class
//
//   central_conflict ──causal──────────► protagonist_arc
//                    ──resolutional──► resolution_type
//
//   protagonist_arc ──resolutional──► resolution_type
//                   ──structural────► midpoint_reversal
//
// Terminal axes (no outgoing edges): resolution_type, stakes_class,
//   inciting_incident, midpoint_reversal, tonal_gravity
//
// No cycles. Verified by inspection (9 axes, all terminal nodes have
// no outgoing edges back to any upstream axis).

export const NARRATIVE_DEPENDENCY_EDGES: ReadonlyArray<NarrativeDependencyEdge> = [
  // ── story_engine outgoing ────────────────────────────────────────────
  {
    from: "story_engine",
    to: "pressure_system",
    dependency_type: "structural",
    confidence: "canonical",
    note: "The engine type (e.g. survival, revenge, discovery) determines which pressure grammar is structurally coherent. A survival engine requires environmental/systemic pressure; a revenge engine requires interpersonal pressure. Changing the engine risks invalidating the pressure system.",
  },
  {
    from: "story_engine",
    to: "central_conflict",
    dependency_type: "structural",
    confidence: "canonical",
    note: "The engine defines the dominant conflict topology. A discovery engine implies an epistemic conflict; a survival engine implies an existential one. Changing the engine may require a new conflict classification.",
  },
  {
    from: "story_engine",
    to: "inciting_incident",
    dependency_type: "causal",
    confidence: "canonical",
    note: "The inciting incident is the structural trigger that activates the engine. Different engines are triggered by structurally different incident categories. Changing the engine risks requiring a different trigger class.",
  },

  // ── pressure_system outgoing ──────────────────────────────────────────
  {
    from: "pressure_system",
    to: "protagonist_arc",
    dependency_type: "causal",
    confidence: "canonical",
    note: "The pressure mechanism drives the protagonist's transformation. Environmental/systemic pressure produces different arc shapes than interpersonal or internal pressure. A changed pressure system may require a different arc trajectory.",
  },
  {
    from: "pressure_system",
    to: "stakes_class",
    dependency_type: "causal",
    confidence: "canonical",
    note: "The pressure grammar determines the emotional register of what is at risk. Systemic pressure (e.g. survival) implies survival/civilisational stakes; interpersonal pressure implies personal/relational stakes.",
  },

  // ── central_conflict outgoing ─────────────────────────────────────────
  {
    from: "central_conflict",
    to: "protagonist_arc",
    dependency_type: "causal",
    confidence: "canonical",
    note: "The conflict topology shapes how the protagonist is transformed. An external conflict (person-vs-society) demands a different arc than an internal conflict (person-vs-self). A changed conflict type risks misaligning the arc.",
  },
  {
    from: "central_conflict",
    to: "resolution_type",
    dependency_type: "resolutional",
    confidence: "canonical",
    note: "The conflict topology constrains which resolutions are structurally valid. A tragic conflict topology cannot resolve catharticly without narrative tension. Changing the conflict may require changing the resolution promise.",
  },

  // ── protagonist_arc outgoing ──────────────────────────────────────────
  {
    from: "protagonist_arc",
    to: "resolution_type",
    dependency_type: "resolutional",
    confidence: "canonical",
    note: "The arc endpoint (transformation achieved or denied) must align with the resolution type (redemptive, ambiguous, tragic, etc.). A redemptive arc implies a resolution type that permits catharsis. Changing the arc endpoint risks invalidating the resolution promise.",
  },
  {
    from: "protagonist_arc",
    to: "midpoint_reversal",
    dependency_type: "structural",
    confidence: "canonical",
    note: "The midpoint reversal type serves the protagonist's arc — it must be structurally appropriate to the arc direction. A fall arc requires a different midpoint pivot than a redemption arc.",
  },
];

// ── Graph Helpers ─────────────────────────────────────────────────────────

/**
 * Returns all axes directly downstream of the given axis (one hop).
 */
export function getDirectDownstream(axis: SpineAxis): SpineAxis[] {
  return NARRATIVE_DEPENDENCY_EDGES
    .filter(e => e.from === axis)
    .map(e => e.to);
}

/**
 * Returns all axes directly upstream of the given axis (one hop).
 */
export function getDirectUpstream(axis: SpineAxis): SpineAxis[] {
  return NARRATIVE_DEPENDENCY_EDGES
    .filter(e => e.to === axis)
    .map(e => e.from);
}

/**
 * Returns all axes transitively downstream of the given axis,
 * deduplicated and cycle-safe (visited set).
 * BFS order — breadth-first so the closest dependents appear first.
 */
export function getDownstreamAxes(axis: SpineAxis): SpineAxis[] {
  const visited = new Set<SpineAxis>();
  const queue: SpineAxis[] = [axis];
  const result: SpineAxis[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = getDirectDownstream(current);
    for (const child of children) {
      if (!visited.has(child) && child !== axis) {
        visited.add(child);
        result.push(child);
        queue.push(child);
      }
    }
  }

  return result;
}

/**
 * Returns all axes transitively upstream of the given axis,
 * deduplicated and cycle-safe.
 */
export function getUpstreamAxes(axis: SpineAxis): SpineAxis[] {
  const visited = new Set<SpineAxis>();
  const queue: SpineAxis[] = [axis];
  const result: SpineAxis[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const parents = getDirectUpstream(current);
    for (const parent of parents) {
      if (!visited.has(parent) && parent !== axis) {
        visited.add(parent);
        result.push(parent);
        queue.push(parent);
      }
    }
  }

  return result;
}

/**
 * Returns the shortest dependency chain from 'from' to 'to' using BFS.
 * Returns null if no path exists.
 */
export function getDependencyChain(from: SpineAxis, to: SpineAxis): SpineAxis[] | null {
  if (from === to) return [from];

  const visited = new Set<SpineAxis>([from]);
  // queue entries: [currentAxis, pathSoFar]
  const queue: [SpineAxis, SpineAxis[]][] = [[from, [from]]];

  while (queue.length > 0) {
    const [current, path] = queue.shift()!;
    const children = getDirectDownstream(current);
    for (const child of children) {
      const newPath = [...path, child];
      if (child === to) return newPath;
      if (!visited.has(child)) {
        visited.add(child);
        queue.push([child, newPath]);
      }
    }
  }

  return null; // no path
}

/**
 * Given a set of changed axes, returns the full set of downstream axes
 * at risk (union, deduplicated).
 * Excludes the changed axes themselves from the result.
 */
export function getImpactedAxes(changedAxes: SpineAxis[]): SpineAxis[] {
  const allImpacted = new Set<SpineAxis>();
  for (const axis of changedAxes) {
    for (const downstream of getDownstreamAxes(axis)) {
      allImpacted.add(downstream);
    }
  }
  // Exclude the changed axes themselves
  for (const changed of changedAxes) {
    allImpacted.delete(changed);
  }
  return Array.from(allImpacted);
}

/**
 * For each changed axis, computes a PropagatedRisk entry listing
 * downstream axes and the dependency chains connecting them.
 * Only emits entries where downstream axes exist.
 */
export function computePropagatedRisk(changedAxes: SpineAxis[]): PropagatedRisk[] {
  const result: PropagatedRisk[] = [];

  for (const axis of changedAxes) {
    const downstream = getDownstreamAxes(axis);
    if (downstream.length === 0) continue;

    const chains: SpineAxis[][] = downstream
      .map(d => getDependencyChain(axis, d))
      .filter((c): c is SpineAxis[] => c !== null);

    result.push({
      source_axis: axis,
      downstream_axes: downstream,
      dependency_chains: chains,
      reason: "canonical_dependency",
    });
  }

  return result;
}

/**
 * Returns the 'dependency_position' hint for a rewrite target:
 *   'root'       — no upstream dependencies in the registry (story_engine)
 *   'upstream'   — has downstream dependents (non-terminal)
 *   'propagated' — has upstream axes in the changed set
 *   'terminal'   — no outgoing edges, no upstream in changed set
 *
 * Used to prioritize rewrites: fix roots before propagated nodes.
 */
export function getDependencyPosition(
  axis: SpineAxis,
  changedAxes: Set<SpineAxis>,
): "root" | "upstream" | "propagated" | "terminal" {
  const hasUpstreamChanged = getUpstreamAxes(axis).some(a => changedAxes.has(a));
  const hasDownstream = getDirectDownstream(axis).length > 0;
  const hasUpstream = getDirectUpstream(axis).length > 0;

  if (!hasUpstream && hasDownstream) return "root";
  if (hasUpstreamChanged) return "propagated";
  if (hasDownstream) return "upstream";
  return "terminal";
}

// ── NDG v2: Risk Scoring Helpers ──────────────────────────────────────────

/**
 * Derives a deterministic confidence factor from unit payload_json metadata.
 * Confidence represents how well the unit's evidence anchors the claim.
 *
 * Tiers:
 *   1.00 — verbatim_quote_verified=true AND section_key is canonical (≠__preamble)
 *           → passage_verified: quote anchored to a known narrative section
 *   0.90 — verbatim_quote_verified=true, any section (incl. __preamble)
 *           → quote exists and was found, but may be in preamble
 *   0.75 — verbatim_quote present but verbatim_quote_verified=false
 *           → model produced a quote but it was not located in the document
 *   0.50 — evidence_excerpt only, or no evidence at all (active/unclear)
 *           → LLM assertion without anchored proof
 *
 * Returns 0.50 when unitMeta is null (fail-safe default).
 */
export function getConfidenceFactor(unitMeta?: UnitConfidenceMeta | null): number {
  if (!unitMeta) return 0.50;

  const vqv = unitMeta.verbatim_quote_verified;
  const sk  = unitMeta.verbatim_quote_match_section_key;
  const vq  = unitMeta.verbatim_quote;

  if (vqv === true && sk && sk !== "__preamble") return 1.00; // canonical passage
  if (vqv === true)                               return 0.90; // verified, any section
  if (vq)                                         return 0.75; // quote present, unverified
  return 0.50;                                                  // assertion / no evidence
}

/**
 * Computes a deterministic risk score for a single source→target edge.
 *
 * Formula: risk_score = severity_weight × (1 / distance) × confidence_factor
 *
 * Returns null if no dependency path exists from source to target.
 *
 * @param sourceAxis   The axis being amended (root of the change)
 * @param targetAxis   The downstream axis being assessed for risk
 * @param unitMeta     payload_json metadata for the TARGET unit (confidence signal)
 */
export function computeDependencyRisk(
  sourceAxis: SpineAxis,
  targetAxis: SpineAxis,
  unitMeta?: UnitConfidenceMeta | null,
): AxisRiskScore | null {
  const chain = getDependencyChain(sourceAxis, targetAxis);
  if (!chain || chain.length < 2) return null; // no path or trivial

  const distance        = chain.length - 1;
  const distanceWeight  = Math.round((1 / distance) * 1000) / 1000; // 3dp
  const severityWeight  = SEVERITY_WEIGHTS[AXIS_METADATA[sourceAxis].severity] ?? 2;
  const confidenceFactor = getConfidenceFactor(unitMeta);
  const riskScore       = Math.round(severityWeight * distanceWeight * confidenceFactor * 100) / 100;

  return {
    source_axis:       sourceAxis,
    target_axis:       targetAxis,
    dependency_chain:  chain,
    severity_weight:   severityWeight,
    distance,
    distance_weight:   distanceWeight,
    confidence_factor: confidenceFactor,
    risk_score:        riskScore,
  };
}

/**
 * Computes risk scores for all downstream axes of a given source axis.
 * Returns results sorted descending by risk_score (highest risk first).
 *
 * @param sourceAxis         The amended axis
 * @param downstreamUnitMeta Map of SpineAxis → payload_json metadata for confidence lookup
 */
export function computeDownstreamRiskScores(
  sourceAxis: SpineAxis,
  downstreamUnitMeta: Map<SpineAxis, UnitConfidenceMeta | null>,
): AxisRiskScore[] {
  const downstream = getDownstreamAxes(sourceAxis);
  const scores: AxisRiskScore[] = [];

  for (const target of downstream) {
    const meta  = downstreamUnitMeta.get(target) ?? null;
    const score = computeDependencyRisk(sourceAxis, target, meta);
    if (score) scores.push(score);
  }

  return scores.sort((a, b) => b.risk_score - a.risk_score);
}

/**
 * Computes a rewrite priority score for a rewrite target axis.
 * Represents "how urgently should this axis be addressed in the rewrite?"
 *
 * Formula: severity_weight × (1 + 0.5 × downstream_count)
 * Axes with high severity AND many downstream dependents score highest.
 *
 * Examples:
 *   story_engine   (severity=5, 7 downstream): 5 × (1 + 3.5) = 22.5
 *   protagonist_arc (severity=5, 2 downstream): 5 × (1 + 1.0) = 10.0
 *   central_conflict (severity=3, 3 downstream): 3 × (1 + 1.5) = 7.5
 *   resolution_type (severity=2, 0 downstream): 2 × (1 + 0.0) = 2.0
 */
export function computeRewritePriorityScore(axis: SpineAxis): number {
  const severityWeight   = SEVERITY_WEIGHTS[AXIS_METADATA[axis].severity] ?? 2;
  const downstreamCount  = getDownstreamAxes(axis).length;
  return Math.round(severityWeight * (1 + 0.5 * downstreamCount) * 100) / 100;
}
