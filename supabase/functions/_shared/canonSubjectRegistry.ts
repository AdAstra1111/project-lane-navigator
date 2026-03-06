/**
 * Canon Subject Registry — Phase 3
 *
 * Deterministic atomic subject-level propagation engine.
 * Extracts canonical subjects from structured canon data (project_canon.canon_json),
 * assigns stable identities, computes subject-level deltas, and determines
 * projection targets for narrowed invalidation.
 *
 * Active classes: format_rule, concept_claim, character_fact, relationship_fact.
 * Deferred (non-deterministic identity): season_arc_obligation.
 *
 * ARCHITECTURE:
 * - Zero schema drift: operates on existing canon_json + dependency registry
 * - Deterministic: same canon JSON → same subjects (stable identity via DJB2a hash)
 * - Additive: narrows invalidation, does NOT replace doc-level fallback
 * - Fail-closed: if extraction fails, returns empty and doc-level invalidation proceeds
 *
 * Subject identity = `${subject_class}::${normalizedKey}`
 * Normalized key varies by class:
 *   character_fact  → lowercase character name
 *   relationship_fact → sorted pair `a<>b`
 *   format_rule     → lowercase label
 *   concept_claim   → field name (logline, premise, etc.)
 *   season_arc_obligation → `arc_thread::index`
 */

import { type LaneKey } from "./documentLadders.ts";
import { getDirectDependents, type DependencyEdge } from "./deliverableDependencyRegistry.ts";

// ── Types ──

export type SubjectClass =
  | "character_fact"
  | "relationship_fact"
  | "format_rule"
  | "concept_claim"
  | "season_arc_obligation";

export interface CanonSubject {
  /** Stable identity: `${subject_class}::${normalized_key}` */
  subject_id: string;
  subject_class: SubjectClass;
  /** Human-readable label */
  label: string;
  /** Normalized key used for identity */
  normalized_key: string;
  /** Extracted value/content (stringified for comparison) */
  value_hash: string;
  /** Raw value for inspection */
  raw_value: unknown;
}

export type SubjectDeltaType = "added" | "removed" | "changed";

export interface SubjectDelta {
  subject_id: string;
  subject_class: SubjectClass;
  label: string;
  delta_type: SubjectDeltaType;
  previous_hash: string | null;
  current_hash: string | null;
}

export interface SubjectClassConfig {
  subject_class: SubjectClass;
  /** Doc types that define/source this subject class */
  source_doc_types: string[];
  /** Doc types where this subject is projected/used */
  projection_doc_types: string[];
  /** Dependency kind that governs propagation */
  dependency_kind: string;
  /** Whether extraction is deterministic for this class */
  extraction_deterministic: boolean;
  /**
   * Whether this class is active in the initial Phase 3 rollout.
   * Classes marked false are structurally defined but excluded from
   * extraction and delta computation until their identity model is hardened.
   */
  active_in_initial_rollout: boolean;
}

export interface SubjectPropagationPlan {
  source_doc_type: string;
  deltas: SubjectDelta[];
  /** Map of projection doc_type → list of deltas that affect it */
  affected_projections: Record<string, SubjectDelta[]>;
  /** Doc types NOT affected by this delta set */
  unaffected_doc_types: string[];
  /** Total projection targets narrowed (vs full invalidation) */
  narrowing_ratio: number;
}

// ── Subject Class Registry ──

const SUBJECT_CLASS_CONFIGS: Record<SubjectClass, SubjectClassConfig> = {
  character_fact: {
    subject_class: "character_fact",
    source_doc_types: ["character_bible", "treatment", "concept_brief"],
    projection_doc_types: [
      "character_bible", "season_arc", "beat_sheet", "episode_beats",
      "vertical_episode_beats", "feature_script", "episode_script",
      "season_script", "story_outline",
    ],
    dependency_kind: "canon",
    extraction_deterministic: true,
    active_in_initial_rollout: true,
  },
  relationship_fact: {
    subject_class: "relationship_fact",
    source_doc_types: ["character_bible"],
    projection_doc_types: [
      "character_bible", "season_arc", "beat_sheet", "episode_beats",
      "feature_script", "episode_script", "season_script",
    ],
    dependency_kind: "canon",
    // Phase 3F: Activated using structured relationship data from
    // characters[].relationships[] (Phase 3E structured extraction).
    // Identity: sorted pair `a<>b` for stable, direction-independent propagation.
    // Old regex-based extraction (extractRelationshipPairs) is replaced.
    extraction_deterministic: true,
    active_in_initial_rollout: true,
  },
  format_rule: {
    subject_class: "format_rule",
    source_doc_types: ["format_rules", "concept_brief"],
    projection_doc_types: [
      "format_rules", "character_bible", "season_arc", "episode_grid",
      "vertical_episode_beats", "season_script", "episode_script",
      "feature_script",
    ],
    dependency_kind: "style",
    extraction_deterministic: true,
    active_in_initial_rollout: true,
  },
  concept_claim: {
    subject_class: "concept_claim",
    source_doc_types: ["concept_brief", "idea"],
    projection_doc_types: [
      "concept_brief", "treatment", "market_sheet", "vertical_market_sheet",
      "character_bible", "story_outline",
    ],
    dependency_kind: "canon",
    extraction_deterministic: true,
    active_in_initial_rollout: true,
  },
  season_arc_obligation: {
    subject_class: "season_arc_obligation",
    source_doc_types: ["season_arc"],
    projection_doc_types: [
      "season_arc", "episode_grid", "vertical_episode_beats",
      "episode_beats", "episode_script", "season_script",
    ],
    dependency_kind: "structure",
    // EXCLUDED from initial rollout: index-based identity (arc_thread::0)
    // is order-fragile — reordering or editing ongoing_threads lines shifts
    // all subsequent identities, producing phantom adds/removes.
    // Requires content-hash-based identity to be safe.
    extraction_deterministic: false,
    active_in_initial_rollout: false,
  },
};

// ── Public API ──

/**
 * Get config for a subject class. Returns null if unknown.
 */
export function getSubjectClassConfig(sc: SubjectClass): SubjectClassConfig | null {
  return SUBJECT_CLASS_CONFIGS[sc] || null;
}

/**
 * List all supported subject classes.
 */
export function listSubjectClasses(): SubjectClass[] {
  return Object.keys(SUBJECT_CLASS_CONFIGS) as SubjectClass[];
}

/**
 * Check whether a doc type is a source for any ACTIVE subject class.
 * Only classes with active_in_initial_rollout=true are considered.
 */
export function isSubjectSourceDocType(docType: string): boolean {
  return Object.values(SUBJECT_CLASS_CONFIGS).some(
    c => c.active_in_initial_rollout && c.source_doc_types.includes(docType),
  );
}

/**
 * Get all ACTIVE subject classes sourced from a given doc type.
 */
export function getSubjectClassesForSourceDoc(docType: string): SubjectClass[] {
  return Object.values(SUBJECT_CLASS_CONFIGS)
    .filter(c => c.active_in_initial_rollout && c.source_doc_types.includes(docType))
    .map(c => c.subject_class);
}

// ── Subject Extraction ──

/**
 * Extract canonical subjects from a canon JSON object.
 * Deterministic: same input → same output.
 * Fail-closed: returns empty array on any error.
 */
export function extractCanonicalSubjects(canonJson: Record<string, unknown>): CanonSubject[] {
  const subjects: CanonSubject[] = [];

  try {
    // ── Concept claims ──
    for (const field of ["logline", "premise", "timeline", "world_rules", "locations", "tone_style", "ongoing_threads"] as const) {
      const val = canonJson[field];
      if (val && typeof val === "string" && val.trim().length > 0) {
        const nk = field;
        subjects.push({
          subject_id: `concept_claim::${nk}`,
          subject_class: "concept_claim",
          label: field.replace(/_/g, " "),
          normalized_key: nk,
          value_hash: djb2Hash(String(val).trim()),
          raw_value: val,
        });
      }
    }

    // ── Format rules ──
    const formatConstraints = canonJson.format_constraints;
    if (formatConstraints && typeof formatConstraints === "string" && formatConstraints.trim().length > 0) {
      subjects.push({
        subject_id: "format_rule::format_constraints",
        subject_class: "format_rule",
        label: "Format Constraints",
        normalized_key: "format_constraints",
        value_hash: djb2Hash(formatConstraints.trim()),
        raw_value: formatConstraints,
      });
    }
    // Forbidden changes as a locked format rule
    const forbidden = canonJson.forbidden_changes;
    if (forbidden && typeof forbidden === "string" && forbidden.trim().length > 0) {
      subjects.push({
        subject_id: "format_rule::forbidden_changes",
        subject_class: "format_rule",
        label: "Locked Facts / Forbidden Changes",
        normalized_key: "forbidden_changes",
        value_hash: djb2Hash(forbidden.trim()),
        raw_value: forbidden,
      });
    }

    // ── Character facts + relationship edge collection ──
    const relationshipEdges: Array<{ source: string; target: string; arc_summary: string }> = [];
    if (Array.isArray(canonJson.characters)) {
      for (const char of canonJson.characters) {
        if (!char || typeof char !== "object" || !char.name) continue;
        const name = String(char.name).trim();
        if (name.length < 2) continue;
        const nk = name.toLowerCase();
        // Build a deterministic value string from all character fields
        const valParts = [name];
        for (const f of ["role", "goals", "traits", "secrets", "backstory", "arc"] as const) {
          if ((char as any)[f]) valParts.push(`${f}:${String((char as any)[f]).trim()}`);
        }
        subjects.push({
          subject_id: `character_fact::${nk}`,
          subject_class: "character_fact",
          label: name,
          normalized_key: nk,
          value_hash: djb2Hash(valParts.join("|")),
          raw_value: char,
        });

        // ── Phase 3F: Relationship facts from structured characters[].relationships[] ──
        // Collect directional edges; will be merged into sorted pairs below.
        const rels = (char as any).relationships;
        if (Array.isArray(rels)) {
          for (const rel of rels) {
            if (!rel || typeof rel !== "object") continue;
            const targetName = rel.target_name;
            if (!targetName || typeof targetName !== "string" || targetName.trim().length < 2) continue;
            const arcSummary = rel.arc_summary || "";
            relationshipEdges.push({
              source: name,
              target: targetName.trim(),
              arc_summary: typeof arcSummary === "string" ? arcSummary.trim() : "",
            });
          }
        }
      }
    }

    // ── Merge relationship edges into sorted pair subjects ──
    // Each unique sorted pair (a<>b) becomes one relationship_fact subject.
    // If both directions exist, summaries are concatenated for stable hashing.
    const pairMap = new Map<string, { a: string; b: string; summaries: string[] }>();
    for (const edge of relationshipEdges) {
      const [a, b] = [edge.source, edge.target].sort((x, y) =>
        x.toLowerCase().localeCompare(y.toLowerCase()),
      );
      const pairKey = `${a.toLowerCase()}<>${b.toLowerCase()}`;
      if (!pairMap.has(pairKey)) {
        pairMap.set(pairKey, { a, b, summaries: [] });
      }
      if (edge.arc_summary.length > 0) {
        pairMap.get(pairKey)!.summaries.push(edge.arc_summary);
      }
    }

    for (const [pairKey, pair] of pairMap) {
      // Deterministic: sort summaries for stable hash regardless of extraction order
      const sortedSummaries = pair.summaries.sort();
      const valueStr = `${pair.a}|${pair.b}|${sortedSummaries.join("||")}`;
      subjects.push({
        subject_id: `relationship_fact::${pairKey}`,
        subject_class: "relationship_fact",
        label: `${pair.a} ↔ ${pair.b}`,
        normalized_key: pairKey,
        value_hash: djb2Hash(valueStr),
        raw_value: { a: pair.a, b: pair.b, summaries: sortedSummaries },
      });
    }

    // ── Season arc obligations — EXCLUDED from initial rollout ──
    // Skipped: index-based identity is order-fragile (see registry config).
    // Will be re-enabled when content-hash-based identity is implemented.
  } catch (err) {
    // Fail closed: return whatever was extracted so far
    console.warn(`[canon-subject-registry] extraction_error: ${(err as any)?.message}`);
  }

  return subjects;
}

// ── Subject Identity ──

/**
 * Compute stable subject identity. Already embedded in subject_id during extraction.
 */
export function computeSubjectIdentity(subjectClass: SubjectClass, normalizedKey: string): string {
  return `${subjectClass}::${normalizedKey}`;
}

// ── Subject Diffing ──

/**
 * Compute a deterministic delta between two subject snapshots.
 * Returns added, removed, and changed subjects.
 */
export function diffCanonicalSubjects(
  previous: CanonSubject[],
  current: CanonSubject[],
): SubjectDelta[] {
  const deltas: SubjectDelta[] = [];
  const prevMap = new Map(previous.map(s => [s.subject_id, s]));
  const currMap = new Map(current.map(s => [s.subject_id, s]));

  // Added or changed
  for (const [id, curr] of currMap) {
    const prev = prevMap.get(id);
    if (!prev) {
      deltas.push({
        subject_id: id,
        subject_class: curr.subject_class,
        label: curr.label,
        delta_type: "added",
        previous_hash: null,
        current_hash: curr.value_hash,
      });
    } else if (prev.value_hash !== curr.value_hash) {
      deltas.push({
        subject_id: id,
        subject_class: curr.subject_class,
        label: curr.label,
        delta_type: "changed",
        previous_hash: prev.value_hash,
        current_hash: curr.value_hash,
      });
    }
  }

  // Removed
  for (const [id, prev] of prevMap) {
    if (!currMap.has(id)) {
      deltas.push({
        subject_id: id,
        subject_class: prev.subject_class,
        label: prev.label,
        delta_type: "removed",
        previous_hash: prev.value_hash,
        current_hash: null,
      });
    }
  }

  return deltas;
}

// ── Projection Target Resolution ──

/**
 * Get all projection doc types affected by a set of subject deltas.
 * Uses the subject class registry to determine projection surfaces,
 * then intersects with the lane-aware dependency registry.
 */
export function getSubjectProjectionTargets(
  deltas: SubjectDelta[],
  lane: LaneKey,
  sourceDocType: string,
): { affected: string[]; unaffected: string[] } {
  // Collect all projection doc types from affected subject classes
  const affectedClasses = new Set(deltas.map(d => d.subject_class));
  const projectionSet = new Set<string>();

  for (const sc of affectedClasses) {
    const config = SUBJECT_CLASS_CONFIGS[sc];
    if (!config) continue;
    for (const dt of config.projection_doc_types) {
      projectionSet.add(dt);
    }
  }

  // Intersect with actual dependency edges from the source doc type
  const directDeps = getDirectDependents(lane, sourceDocType);
  const reachableDocs = new Set(directDeps.map(e => e.to_doc_type));

  // BFS for transitive deps
  const queue = [...reachableDocs];
  const visited = new Set(reachableDocs);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = getDirectDependents(lane, current);
    for (const e of edges) {
      if (!visited.has(e.to_doc_type)) {
        visited.add(e.to_doc_type);
        reachableDocs.add(e.to_doc_type);
        queue.push(e.to_doc_type);
      }
    }
  }

  // Affected = reachable AND in projection set
  const affected = [...reachableDocs].filter(dt => projectionSet.has(dt));
  const unaffected = [...reachableDocs].filter(dt => !projectionSet.has(dt));

  return { affected, unaffected };
}

// ── Propagation Plan Builder ──

/**
 * Build a full subject-level propagation plan.
 * Computes which projection targets are affected by which subject deltas.
 *
 * Returns null if deltas are empty (no propagation needed).
 */
export function buildSubjectPropagationPlan(
  previousCanon: Record<string, unknown>,
  currentCanon: Record<string, unknown>,
  sourceDocType: string,
  lane: LaneKey,
): SubjectPropagationPlan | null {
  const prevSubjects = extractCanonicalSubjects(previousCanon);
  const currSubjects = extractCanonicalSubjects(currentCanon);
  const deltas = diffCanonicalSubjects(prevSubjects, currSubjects);

  if (deltas.length === 0) return null;

  const { affected, unaffected } = getSubjectProjectionTargets(deltas, lane, sourceDocType);

  // Map deltas to specific projection targets
  const affectedProjections: Record<string, SubjectDelta[]> = {};
  for (const dt of affected) {
    const relevantDeltas = deltas.filter(d => {
      const config = SUBJECT_CLASS_CONFIGS[d.subject_class];
      return config?.projection_doc_types.includes(dt);
    });
    if (relevantDeltas.length > 0) {
      affectedProjections[dt] = relevantDeltas;
    }
  }

  // Narrowing ratio: how much smaller is the affected set vs full downstream
  const totalReachable = affected.length + unaffected.length;
  const narrowingRatio = totalReachable > 0
    ? 1 - (Object.keys(affectedProjections).length / totalReachable)
    : 0;

  return {
    source_doc_type: sourceDocType,
    deltas,
    affected_projections: affectedProjections,
    unaffected_doc_types: unaffected,
    narrowing_ratio: Math.round(narrowingRatio * 100) / 100,
  };
}

// ── Internal Helpers ──

/**
 * DJB2a hash for deterministic value hashing (no crypto dependency).
 */
function djb2Hash(input: string): string {
  let h1 = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
  }
  let h2 = 5381;
  for (let i = 0; i < input.length; i++) {
    h2 = ((h2 << 5) + h2 + input.charCodeAt(i)) >>> 0;
  }
  return `${h1.toString(36)}_${h2.toString(36)}`;
}

// Old extractRelationshipPairs (regex-based, non-deterministic) removed in Phase 3F.
// Replaced by structured extraction from characters[].relationships[] in extractCanonicalSubjects.
