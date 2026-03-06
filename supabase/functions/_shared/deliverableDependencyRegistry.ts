/**
 * Deliverable Dependency Registry — Phase 2B
 *
 * Lane-aware dependency graph with explicit edges, invalidation policies,
 * and revalidation policies. Replaces ladder-only downstream slicing.
 *
 * Dependency kinds:
 *   canon      — narrative truth flows downstream (character_bible → scripts)
 *   structure  — structural scaffolding dependency (beat_sheet → script)
 *   market     — market positioning dependency (market_sheet → deck)
 *   style      — format/tone rules (format_rules → scripts)
 *   advisory   — informational only, no invalidation required
 *
 * Strength:
 *   hard — change MUST trigger downstream staleness
 *   soft — change SHOULD trigger review but not forced regen
 *
 * Invalidation policy:
 *   stale       — mark downstream is_stale=true, force regen
 *   review_only — flag for review, don't force regen
 *   none        — no downstream action
 *
 * Revalidation policy:
 *   must_reanalyze  — auto-run must reanalyze this doc
 *   optional_review — human review suggested
 *   none            — no action needed
 */

import { type LaneKey, LANE_DOC_LADDERS } from "./documentLadders.ts";

// ── Types ────────────────────────────────────────────────────────────────

export type DependencyKind = "canon" | "structure" | "market" | "style" | "advisory";
export type DependencyStrength = "hard" | "soft";
export type InvalidationPolicy = "stale" | "review_only" | "none";
export type RevalidationPolicy = "must_reanalyze" | "optional_review" | "none";

export interface DependencyEdge {
  from_doc_type: string;
  to_doc_type: string;
  kind: DependencyKind;
  strength: DependencyStrength;
  invalidation_policy: InvalidationPolicy;
  revalidation_policy: RevalidationPolicy;
}

export interface InvalidationPlanEntry {
  doc_type: string;
  edge: DependencyEdge;
  invalidation_policy: InvalidationPolicy;
  revalidation_policy: RevalidationPolicy;
}

export interface InvalidationPlan {
  repaired_doc_type: string;
  lane: LaneKey;
  entries: InvalidationPlanEntry[];
  skipped_doc_types: string[];
}

// ── Registry ─────────────────────────────────────────────────────────────
//
// Explicit edges per lane. If a doc pair is not listed, there is NO
// dependency — fail closed (do not invalidate).

const REGISTRY: Record<LaneKey, DependencyEdge[]> = {
  feature_film: [
    // idea → concept_brief
    { from_doc_type: "idea",           to_doc_type: "concept_brief",    kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // concept_brief → market_sheet, treatment
    { from_doc_type: "concept_brief",  to_doc_type: "market_sheet",     kind: "market",    strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",  to_doc_type: "treatment",        kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // market_sheet → deck (market positioning)
    { from_doc_type: "market_sheet",   to_doc_type: "deck",             kind: "market",    strength: "soft", invalidation_policy: "review_only", revalidation_policy: "optional_review" },
    // treatment → story_outline, character_bible
    { from_doc_type: "treatment",      to_doc_type: "story_outline",    kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "treatment",      to_doc_type: "character_bible",  kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // story_outline → beat_sheet
    { from_doc_type: "story_outline",  to_doc_type: "beat_sheet",       kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // character_bible → beat_sheet, feature_script (canon dependency)
    { from_doc_type: "character_bible",to_doc_type: "beat_sheet",       kind: "canon",     strength: "soft", invalidation_policy: "review_only", revalidation_policy: "optional_review" },
    { from_doc_type: "character_bible",to_doc_type: "feature_script",   kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // beat_sheet → feature_script
    { from_doc_type: "beat_sheet",     to_doc_type: "feature_script",   kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // feature_script → production_draft
    { from_doc_type: "feature_script", to_doc_type: "production_draft", kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    // production_draft → deck (advisory)
    { from_doc_type: "production_draft", to_doc_type: "deck",           kind: "advisory",  strength: "soft", invalidation_policy: "none",        revalidation_policy: "none" },
  ],

  series: [
    { from_doc_type: "idea",             to_doc_type: "concept_brief",        kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",    to_doc_type: "market_sheet",         kind: "market",    strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",    to_doc_type: "treatment",            kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "treatment",        to_doc_type: "story_outline",        kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "treatment",        to_doc_type: "character_bible",      kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "story_outline",    to_doc_type: "beat_sheet",           kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "character_bible",  to_doc_type: "beat_sheet",           kind: "canon",     strength: "soft", invalidation_policy: "review_only", revalidation_policy: "optional_review" },
    { from_doc_type: "character_bible",  to_doc_type: "episode_script",       kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "beat_sheet",       to_doc_type: "episode_beats",        kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "episode_beats",    to_doc_type: "episode_script",       kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "episode_script",   to_doc_type: "season_master_script", kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "season_master_script", to_doc_type: "production_draft", kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
  ],

  vertical_drama: [
    { from_doc_type: "idea",                    to_doc_type: "concept_brief",           kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",           to_doc_type: "vertical_market_sheet",   kind: "market",    strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",           to_doc_type: "format_rules",            kind: "style",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "format_rules",            to_doc_type: "character_bible",         kind: "style",     strength: "soft", invalidation_policy: "review_only", revalidation_policy: "optional_review" },
    { from_doc_type: "format_rules",            to_doc_type: "season_script",           kind: "style",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",           to_doc_type: "character_bible",         kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "character_bible",         to_doc_type: "season_arc",              kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "character_bible",         to_doc_type: "season_script",           kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "season_arc",              to_doc_type: "episode_grid",            kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "episode_grid",            to_doc_type: "vertical_episode_beats",  kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "vertical_episode_beats",  to_doc_type: "season_script",           kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
  ],

  documentary: [
    { from_doc_type: "idea",                to_doc_type: "concept_brief",       kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",       to_doc_type: "market_sheet",        kind: "market",    strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",       to_doc_type: "documentary_outline", kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "market_sheet",        to_doc_type: "deck",                kind: "market",    strength: "soft", invalidation_policy: "review_only", revalidation_policy: "optional_review" },
    { from_doc_type: "documentary_outline", to_doc_type: "deck",                kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
  ],

  animation: [
    { from_doc_type: "idea",             to_doc_type: "concept_brief",    kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",    to_doc_type: "market_sheet",     kind: "market",    strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",    to_doc_type: "treatment",        kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "treatment",        to_doc_type: "character_bible",  kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "character_bible",  to_doc_type: "beat_sheet",       kind: "canon",     strength: "soft", invalidation_policy: "review_only", revalidation_policy: "optional_review" },
    { from_doc_type: "character_bible",  to_doc_type: "feature_script",   kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "beat_sheet",       to_doc_type: "feature_script",   kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
  ],

  short: [
    { from_doc_type: "idea",           to_doc_type: "concept_brief",    kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",  to_doc_type: "feature_script",   kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
  ],

  unspecified: [
    // Fallback: mirrors feature_film
    { from_doc_type: "idea",           to_doc_type: "concept_brief",    kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",  to_doc_type: "market_sheet",     kind: "market",    strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "concept_brief",  to_doc_type: "treatment",        kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "treatment",      to_doc_type: "story_outline",    kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "treatment",      to_doc_type: "character_bible",  kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "story_outline",  to_doc_type: "beat_sheet",       kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "character_bible",to_doc_type: "feature_script",   kind: "canon",     strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "beat_sheet",     to_doc_type: "feature_script",   kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "feature_script", to_doc_type: "production_draft", kind: "structure", strength: "hard", invalidation_policy: "stale",       revalidation_policy: "must_reanalyze" },
    { from_doc_type: "production_draft",to_doc_type: "deck",            kind: "advisory",  strength: "soft", invalidation_policy: "none",        revalidation_policy: "none" },
  ],
};

// ── Pre-computed lookup indexes ──────────────────────────────────────────

const _edgesByFromDoc: Record<string, Record<string, DependencyEdge[]>> = {};

function _getEdgeIndex(lane: LaneKey): Record<string, DependencyEdge[]> {
  if (!_edgesByFromDoc[lane]) {
    const idx: Record<string, DependencyEdge[]> = {};
    for (const edge of REGISTRY[lane] || []) {
      if (!idx[edge.from_doc_type]) idx[edge.from_doc_type] = [];
      idx[edge.from_doc_type].push(edge);
    }
    _edgesByFromDoc[lane] = idx;
  }
  return _edgesByFromDoc[lane];
}

// ── Public API ───────────────────────────────────────────────────────────

/** Get all direct dependents of a doc type in a given lane */
export function getDirectDependents(lane: LaneKey, docType: string): DependencyEdge[] {
  return _getEdgeIndex(lane)[docType] || [];
}

/** Get a specific edge between two doc types */
export function getDependencyEdge(lane: LaneKey, fromDocType: string, toDocType: string): DependencyEdge | null {
  const edges = getDirectDependents(lane, fromDocType);
  return edges.find(e => e.to_doc_type === toDocType) || null;
}

/** Get transitive dependents (BFS) — returns unique doc types reachable downstream */
export function getTransitiveDependents(lane: LaneKey, docType: string): DependencyEdge[] {
  const visited = new Set<string>();
  const result: DependencyEdge[] = [];
  const queue = [docType];
  visited.add(docType);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = getDirectDependents(lane, current);
    for (const edge of edges) {
      result.push(edge);
      if (!visited.has(edge.to_doc_type)) {
        visited.add(edge.to_doc_type);
        queue.push(edge.to_doc_type);
      }
    }
  }

  return result;
}

// ── Policy precedence (strictest wins) ───────────────────────────────────

const INVALIDATION_RANK: Record<InvalidationPolicy, number> = { none: 0, review_only: 1, stale: 2 };
const REVALIDATION_RANK: Record<RevalidationPolicy, number> = { none: 0, optional_review: 1, must_reanalyze: 2 };

/**
 * Build a precise invalidation plan for a repaired doc type.
 *
 * Uses transitive dependency traversal. Collects ALL candidate edges
 * per target doc, then selects the strictest invalidation + revalidation
 * policy using explicit precedence ranks (stale > review_only > none,
 * must_reanalyze > optional_review > none).
 *
 * This guarantees registry edge ordering never changes outcomes.
 */
export function getInvalidationPlan(lane: LaneKey, repairedDocType: string): InvalidationPlan {
  const transitiveEdges = getTransitiveDependents(lane, repairedDocType);

  // Phase 1: collect ALL candidate edges per target doc type
  const candidates = new Map<string, DependencyEdge[]>();
  for (const edge of transitiveEdges) {
    if (!candidates.has(edge.to_doc_type)) {
      candidates.set(edge.to_doc_type, []);
    }
    candidates.get(edge.to_doc_type)!.push(edge);
  }

  // Phase 2: resolve strictest policy per target
  const entries: InvalidationPlanEntry[] = [];
  const skipped: string[] = [];

  for (const [docType, edges] of candidates) {
    // Pick the edge with the strictest invalidation policy;
    // break ties by strictest revalidation policy.
    let winner = edges[0];
    for (let i = 1; i < edges.length; i++) {
      const challenger = edges[i];
      const winnerInvRank = INVALIDATION_RANK[winner.invalidation_policy];
      const challengerInvRank = INVALIDATION_RANK[challenger.invalidation_policy];
      if (challengerInvRank > winnerInvRank) {
        winner = challenger;
      } else if (challengerInvRank === winnerInvRank) {
        if (REVALIDATION_RANK[challenger.revalidation_policy] > REVALIDATION_RANK[winner.revalidation_policy]) {
          winner = challenger;
        }
      }
    }

    if (winner.invalidation_policy === "none") {
      skipped.push(docType);
    } else {
      entries.push({
        doc_type: docType,
        edge: winner,
        invalidation_policy: winner.invalidation_policy,
        revalidation_policy: winner.revalidation_policy,
      });
    }

    if (edges.length > 1) {
      console.log(`[dependency-registry] multi-path resolution for "${docType}": ${edges.length} candidates → winner="${winner.from_doc_type}→${winner.to_doc_type}" policy=${winner.invalidation_policy}/${winner.revalidation_policy}`);
    }
  }

  // Also list ladder docs that exist after repaired doc but have NO dependency edge
  const ladder = LANE_DOC_LADDERS[lane] || [];
  const repairedIdx = ladder.indexOf(repairedDocType);
  if (repairedIdx >= 0) {
    for (let i = repairedIdx + 1; i < ladder.length; i++) {
      const dt = ladder[i];
      if (!candidates.has(dt)) {
        skipped.push(dt);
      }
    }
  }

  console.log(`[dependency-registry] getInvalidationPlan { lane: "${lane}", repaired: "${repairedDocType}", invalidate: [${entries.map(e => `${e.doc_type}(${e.invalidation_policy})`).join(",")}], skipped: [${skipped.join(",")}] }`);

  return { repaired_doc_type: repairedDocType, lane, entries, skipped_doc_types: skipped };
}

/** Check if a lane has explicit registry entries */
export function hasRegistryEntries(lane: LaneKey): boolean {
  return (REGISTRY[lane]?.length || 0) > 0;
}
