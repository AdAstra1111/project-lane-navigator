/**
 * patchBlueprintEngine.ts — L5: Deterministic Patch Blueprint Generation
 *
 * Converts enriched rewrite_targets (NDG v1–v3 metadata included) into structured
 * repair instructions that tell a producer (or future execution engine) exactly what
 * kind of repair should be made, without performing it.
 *
 * L5.1: Entity-aware patch blueprints.
 * Blueprints are now enriched with NIT entity data (primary_entity, affected_entities,
 * preserve_entities) where deterministic mappings exist. Structure-only blueprints are
 * unchanged. All entity enrichment is optional and additive.
 *
 * Constraints:
 *   - No LLM calls. No text generation. No speculative inference.
 *   - No document mutation. No lifecycle state changes.
 *   - No extra DB queries inside this module — entity context passed in by caller.
 *   - All wording is templated and deterministic.
 *   - Fail-safe: missing fields are omitted or given safe fallback values.
 *   - If entityContext is absent: blueprints are structure-only (backward compatible).
 */

import { type SpineAxis, AXIS_METADATA } from "./narrativeSpine.ts";
import { getUpstreamAxes, type PropagatedRisk } from "./narrativeDependencyGraph.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export type PatchUrgency = "critical" | "high" | "medium" | "low";

// ── L5.1: Entity context types ─────────────────────────────────────────────

/**
 * Lightweight entity record passed into blueprint assembly from the caller.
 * Caller loads narrative_entities + relations; engine consumes them deterministically.
 */
export interface NarrativeEntityRecord {
  entity_key:     string;
  entity_type:    string;   // 'character' | 'arc' | 'conflict'
  canonical_name: string;
  status:         string;
  meta_json:      Record<string, any>;
}

export interface NarrativeRelationRecord {
  source_key:    string;    // entity_key of source
  target_key:    string;    // entity_key of target
  relation_type: string;    // 'drives_arc' | 'subject_of_conflict' | 'opposes'
}

/**
 * Bundled entity context passed into buildPatchBlueprints by the caller.
 * If null/absent: all entity fields on blueprints will be null/[].
 */
/**
 * Phase 5: Scene context pre-loaded in spine-rewrite-plan and passed into blueprint building.
 * Keeps patchBlueprintEngine zero-DB.
 * sceneIndex: axis_key → Array<{ scene_key, scene_id, slugline }>
 */
export interface SceneContext {
  sceneIndex: Map<string, Array<{ scene_key: string; scene_id: string; slugline: string | null }>>;
}

export interface EntityContext {
  entities:  NarrativeEntityRecord[];
  relations: NarrativeRelationRecord[];
}

/**
 * A reference to a narrative entity in a patch blueprint.
 * relation_to_patch describes the entity's role relative to the repair:
 *   'primary'  — the structural carrier of the axis being repaired
 *   'affected' — deterministically involved in the repair (will be touched)
 *   'preserve' — must not drift during the repair
 */
export interface PatchBlueprintEntityRef {
  entity_key:       string;
  entity_type:      "character" | "arc" | "conflict";
  canonical_name:   string;
  relation_to_patch: "primary" | "affected" | "preserve";
  rationale?:       string;
}

/**
 * Best-available patch location derived from section_targets.
 * targeting_method reflects the highest-confidence source across all targets.
 * passage_lines is only populated when passage_verified evidence exists.
 */
export interface PatchLocation {
  section_keys: string[];
  section_labels: string[];
  passage_lines: Array<{ start_line: number; end_line: number }>;
  targeting_method: "passage_verified" | "document_verified" | "registry" | null;
}

/**
 * A deterministic patch blueprint for a single rewrite target.
 *
 * All fields derived from already-available planner metadata.
 * Advisory only — no patch execution semantics.
 */
export interface PatchBlueprint {
  /** The spine axis this blueprint addresses */
  axis: SpineAxis;
  /** Human-readable axis label (from AXIS_METADATA) */
  axis_label: string;
  /** Repair order rank from NDG v3 sequencing (null if no rewrite targets were sequenced) */
  sequence_rank: number | null;
  /** Sequence bucket this axis belongs to ('root_fix', 'upstream_fix', etc.) */
  sequence_bucket: string | null;
  /**
   * Urgency derived from severity/priority:
   *   constitutional → critical
   *   high            → high
   *   moderate        → medium
   *   advisory        → low
   */
  urgency: PatchUrgency;
  /** What the patch must achieve (templated from axis + target_spec + reason) */
  patch_goal: string;
  /** Why this patch is needed (templated from contradiction/stale/amendment context) */
  patch_reason: string;
  /**
   * Where the patch belongs in the document.
   * null = no section targeting available for this axis × docType combination.
   * passage_lines populated only when passage_verified evidence exists.
   */
  patch_location: PatchLocation | null;
  /**
   * Preserve constraints derived from aligned preserve_targets.
   * Each entry names an axis whose alignment must be maintained during repair.
   */
  preserve_constraints: string[];
  /**
   * Axes in the current rewrite set that are structurally upstream of this axis.
   * This target should be addressed AFTER its upstream_dependencies are resolved.
   */
  upstream_dependencies: SpineAxis[];
  /**
   * Axes downstream of this target that are at risk if the patch changes the narrative structure.
   * Sourced from propagated_risk entries where source_axis === this axis.
   */
  downstream_risk_axes: SpineAxis[];
  /** Advisory note for the producer or future execution engine */
  execution_note: string;

  // ── L5.1: Entity identity fields — additive, optional ──

  /**
   * The primary narrative entity that structurally carries this axis.
   * null when no deterministic entity mapping exists for this axis.
   * Currently mapped: protagonist_arc (ARC_PROTAGONIST), central_conflict (CONFLICT_PRIMARY).
   */
  primary_entity: PatchBlueprintEntityRef | null;

  /**
   * Entities deterministically involved in this repair (will be touched by the patch).
   * Empty when no deterministic affected-entity mapping exists.
   */
  affected_entities: PatchBlueprintEntityRef[];

  /**
   * Entities that must not drift during this repair.
   * Empty when no deterministic preserve-entity mapping exists.
   */
  preserve_entities: PatchBlueprintEntityRef[];

  // ── Phase 5: Scene-level context — additive, optional ──

  /**
   * Scenes whose spine role maps to this blueprint's axis.
   * Populated from scene_spine_links.axis_key matching this axis.
   * Empty when no scene_spine_links rows exist for this axis.
   * scene_label is the slugline from the latest scene version.
   */
  affected_scenes: Array<{
    scene_key:   string;
    scene_id:    string;
    scene_label: string | null;
  }>;
}

// ── Internal helpers ───────────────────────────────────────────────────────

const METHOD_RANK: Record<string, number> = {
  passage_verified:  3,
  document_verified: 2,
  registry:          1,
};

const PRIORITY_TO_URGENCY: Record<string, PatchUrgency> = {
  constitutional: "critical",
  high:           "high",
  moderate:       "medium",
  advisory:       "low",
};

/**
 * Derives PatchLocation from a section_targets array.
 * Returns null when no section targets exist (fail-closed).
 */
function buildPatchLocation(sectionTargets: any[] | null | undefined): PatchLocation | null {
  if (!sectionTargets || sectionTargets.length === 0) return null;

  let bestMethodRank = 0;
  let bestMethod: PatchLocation["targeting_method"] = null;
  const section_keys: string[] = [];
  const section_labels: string[] = [];
  const passage_lines: Array<{ start_line: number; end_line: number }> = [];

  for (const st of sectionTargets) {
    // Deduplicate section keys
    if (!section_keys.includes(st.section_key)) {
      section_keys.push(st.section_key);
      section_labels.push(st.section_label || st.section_key);
    }

    // Track best method seen across all entries
    const rank = METHOD_RANK[st.targeting_method as string] ?? 0;
    if (rank > bestMethodRank) {
      bestMethodRank = rank;
      bestMethod = st.targeting_method as PatchLocation["targeting_method"];
    }

    // Collect passage lines (only for passage_verified entries)
    if (st.targeting_method === "passage_verified" && st.passage_start_line != null) {
      passage_lines.push({
        start_line: st.passage_start_line,
        end_line:   st.passage_end_line ?? st.passage_start_line,
      });
    }
  }

  return { section_keys, section_labels, passage_lines, targeting_method: bestMethod };
}

/**
 * Templated patch_goal string.
 * No LLM. No text generation. Always deterministic.
 */
function buildPatchGoal(
  axisLabel: string,
  targetSpec: string | null,
  reason: string,
): string {
  const specPart = targetSpec ? `: "${targetSpec}"` : "";
  if (reason === "contradicted") {
    return `Update ${axisLabel} so the document reflects the canonical spine requirement${specPart}`;
  }
  // stale
  return `Reconcile ${axisLabel} with the amended spine specification${specPart}`;
}

/**
 * Templated patch_reason string.
 * No LLM. No text generation. Always deterministic.
 */
function buildPatchReason(
  axisLabel: string,
  reason: string,
  amendmentContext: string | null,
): string {
  if (reason === "contradicted") {
    return (
      `The document actively contradicts the canonical ${axisLabel} requirement. ` +
      `The spine specification has not changed but the document evidence reads differently.`
    );
  }
  // stale
  if (amendmentContext) {
    return (
      `${amendmentContext} — this ${axisLabel} unit was validated against the previous spine ` +
      `value and must be reconciled with the updated requirement.`
    );
  }
  return (
    `The spine was amended after this unit was last validated. ` +
    `${axisLabel} must be reconciled with the current spine requirement before the next reanalysis.`
  );
}

/**
 * Templated execution_note string based on sequence bucket.
 * No LLM. Always deterministic.
 */
function buildExecutionNote(
  sequenceBucket: string | null | undefined,
  sequenceRank: number | null | undefined,
): string {
  switch (sequenceBucket) {
    case "root_fix":
      return (
        "This is the root structural driver. Address this first — all sequenced targets " +
        "depend on resolving it before downstream repairs are attempted."
      );
    case "upstream_fix":
      return (
        "Address after any root_fix targets are complete. Downstream axes will be affected " +
        "by how this upstream axis is resolved — confirm the fix before proceeding."
      );
    case "propagated_followup":
      return (
        "Address after upstream fixes are complete. This issue may partially resolve once " +
        "upstream causes are repaired — revalidate before applying this patch."
      );
    case "terminal_cleanup":
      return (
        "Address last, after causal structure is fully confirmed. Resolve all upstream and " +
        "propagated axes first to avoid re-work on this terminal outcome."
      );
    case "isolated":
      return "No upstream structural dependencies identified in the dependency graph. Address independently.";
    default:
      return sequenceRank != null
        ? `Sequence rank ${sequenceRank} in the repair order. Refer to rewrite_sequence for context.`
        : "Repair order not determined — address as part of the broader rewrite plan.";
  }
}

// ── L5.1: Deterministic axis → entity mapping ──────────────────────────────

interface AxisEntityResult {
  primary:  PatchBlueprintEntityRef | null;
  affected: PatchBlueprintEntityRef[];
  preserve: PatchBlueprintEntityRef[];
}

const EMPTY_ENTITY_RESULT: AxisEntityResult = { primary: null, affected: [], preserve: [] };

/**
 * Maps a spine axis to its narrative entities using the EntityContext.
 *
 * Deterministic only — no inference, no fuzzy matching.
 * Returns EMPTY_ENTITY_RESULT for axes with no clean deterministic mapping.
 *
 * Mapped axes:
 *   protagonist_arc  → ARC_PROTAGONIST (primary); linked protagonist character (affected + preserve)
 *   central_conflict → CONFLICT_PRIMARY (primary); subject character + antagonist (affected)
 *
 * All other axes: structure-only (empty result).
 */
function mapAxisToEntities(axis: SpineAxis, ctx: EntityContext): AxisEntityResult {
  if (axis === "protagonist_arc") {
    const arc = ctx.entities.find(
      e => e.entity_key === "ARC_PROTAGONIST" && e.status === "active"
    );
    if (!arc) return EMPTY_ENTITY_RESULT;

    const primary: PatchBlueprintEntityRef = {
      entity_key:        arc.entity_key,
      entity_type:       "arc",
      canonical_name:    arc.canonical_name,
      relation_to_patch: "primary",
      rationale:         "ARC_PROTAGONIST is the structural registry carrier of the protagonist_arc axis",
    };

    const affected: PatchBlueprintEntityRef[] = [];
    const preserve: PatchBlueprintEntityRef[] = [];

    // linked_character_key in ARC_PROTAGONIST.meta_json — set by NIT v1.1 linkProtagonistArc()
    const linkedCharKey = arc.meta_json?.linked_character_key as string | undefined;
    if (linkedCharKey) {
      const char = ctx.entities.find(
        e => e.entity_key === linkedCharKey && e.status === "active"
      );
      if (char) {
        affected.push({
          entity_key:        char.entity_key,
          entity_type:       "character",
          canonical_name:    char.canonical_name,
          relation_to_patch: "affected",
          rationale:         "Protagonist character is the arc carrier; arc repair must maintain character identity consistency",
        });
        // Protagonist character identity must not drift during arc repair
        preserve.push({
          entity_key:        char.entity_key,
          entity_type:       "character",
          canonical_name:    char.canonical_name,
          relation_to_patch: "preserve",
          rationale:         "Protagonist character identity must remain stable during arc repair",
        });
      }
    }

    return { primary, affected, preserve };
  }

  if (axis === "central_conflict") {
    const conflict = ctx.entities.find(
      e => e.entity_key === "CONFLICT_PRIMARY" && e.status === "active"
    );
    if (!conflict) return EMPTY_ENTITY_RESULT;

    const primary: PatchBlueprintEntityRef = {
      entity_key:        conflict.entity_key,
      entity_type:       "conflict",
      canonical_name:    conflict.canonical_name,
      relation_to_patch: "primary",
      rationale:         "CONFLICT_PRIMARY is the structural registry carrier of the central_conflict axis",
    };

    const affected: PatchBlueprintEntityRef[] = [];

    // subject_of_conflict: character whose relation points TO this conflict
    const subjectRel = ctx.relations.find(
      r => r.target_key === conflict.entity_key && r.relation_type === "subject_of_conflict"
    );
    if (subjectRel) {
      const subject = ctx.entities.find(
        e => e.entity_key === subjectRel.source_key && e.status === "active"
      );
      if (subject) {
        affected.push({
          entity_key:        subject.entity_key,
          entity_type:       "character",
          canonical_name:    subject.canonical_name,
          relation_to_patch: "affected",
          rationale:         "Protagonist is subject_of_conflict; central_conflict repair directly involves this character",
        });

        // Check for antagonist: opposes → subject character
        const opposesRel = ctx.relations.find(
          r => r.target_key === subject.entity_key && r.relation_type === "opposes"
        );
        if (opposesRel) {
          const antagonist = ctx.entities.find(
            e => e.entity_key === opposesRel.source_key && e.status === "active"
          );
          if (antagonist) {
            affected.push({
              entity_key:        antagonist.entity_key,
              entity_type:       "character",
              canonical_name:    antagonist.canonical_name,
              relation_to_patch: "affected",
              rationale:         "Antagonist opposes conflict subject; conflict repair affects the antagonistic dynamic",
            });
          }
        }
      }
    }

    // preserve_entities for central_conflict: empty — the conflict is being repaired, not preserved.
    // Protagonist arc carrier (if present in aligned preserve_targets) is handled at structural level.
    return { primary, affected, preserve: [] };
  }

  // All other axes: structure-only
  return EMPTY_ENTITY_RESULT;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Builds a PatchBlueprint for a single enriched rewrite_target.
 *
 * @param rt              Enriched rewrite_target (includes NDG v1–v3 metadata)
 * @param preserveTargets All preserve_targets from the current plan (for constraints)
 * @param propagatedRisk  Propagated risk array from NDG planner (for downstream axes)
 * @param rewriteAxisSet  Set of all axes in the current rewrite target list (for upstream filtering)
 * @param entityContext   Optional NIT entity context for L5.1 entity enrichment.
 *                        If null/absent, entity fields will be null/[] (backward compatible).
 */
export function buildPatchBlueprint(
  rt: any,
  preserveTargets: any[],
  propagatedRisk: PropagatedRisk[],
  rewriteAxisSet: Set<SpineAxis>,
  entityContext?: EntityContext | null,
  sceneContext?: SceneContext | null,
): PatchBlueprint {
  const axis = rt.axis as SpineAxis;
  const meta = AXIS_METADATA[axis];
  const axisLabel = meta?.label || axis;

  // Urgency — derived from SEVERITY_TO_PRIORITY-style mapping
  const urgency: PatchUrgency = PRIORITY_TO_URGENCY[rt.priority as string] ?? "medium";

  // Patch goal and reason — templated, deterministic
  const patchGoal = buildPatchGoal(axisLabel, rt.target_spec ?? null, rt.reason);
  const patchReason = buildPatchReason(axisLabel, rt.reason, rt.amendment_context ?? null);

  // Patch location — derived from section_targets (fail-closed to null)
  const patchLocation = buildPatchLocation(rt.section_targets);

  // Preserve constraints — aligned preserve_targets only (not provisional 'active')
  // Template: "Preserve [label] alignment: '[spine_value]'"
  const preserveConstraints: string[] = preserveTargets
    .filter(pt => pt.status === "aligned")
    .map(pt => {
      const ptLabel = AXIS_METADATA[pt.axis as SpineAxis]?.label || pt.axis;
      const valPart = pt.spine_value ? `: "${pt.spine_value}"` : "";
      return `Preserve ${ptLabel} alignment${valPart}`;
    });

  // Upstream dependencies — axes in the rewrite set that are structurally upstream of this axis
  // These must be fixed before this target
  const upstreamDependencies: SpineAxis[] = getUpstreamAxes(axis)
    .filter(ax => rewriteAxisSet.has(ax));

  // Downstream risk axes — from propagated_risk where source_axis === this axis
  const propagatedEntry = propagatedRisk.find(pr => pr.source_axis === axis);
  const downstreamRiskAxes: SpineAxis[] = propagatedEntry?.downstream_axes ?? [];

  // Execution note — templated from sequence bucket
  const executionNote = buildExecutionNote(rt.sequence_bucket, rt.sequence_rank);

  // L5.1: Entity enrichment — deterministic, fail-safe
  // mapAxisToEntities returns EMPTY_ENTITY_RESULT when no mapping exists or entityContext absent.
  const entityResult = entityContext
    ? mapAxisToEntities(axis, entityContext)
    : EMPTY_ENTITY_RESULT;

  // Phase 5: Scene context — look up scenes by axis_key matching this blueprint's axis
  // affected_scenes is [] when no scene_spine_links rows exist (fail-closed)
  const affectedScenes: Array<{ scene_key: string; scene_id: string; scene_label: string | null }> = [];
  if (sceneContext && sceneContext.sceneIndex.size > 0) {
    const scenesForAxis = sceneContext.sceneIndex.get(axis) || [];
    for (const s of scenesForAxis) {
      affectedScenes.push({ scene_key: s.scene_key, scene_id: s.scene_id, scene_label: s.slugline ?? null });
    }
  }

  return {
    axis,
    axis_label:             axisLabel,
    sequence_rank:          rt.sequence_rank   ?? null,
    sequence_bucket:        rt.sequence_bucket ?? null,
    urgency,
    patch_goal:             patchGoal,
    patch_reason:           patchReason,
    patch_location:         patchLocation,
    preserve_constraints:   preserveConstraints,
    upstream_dependencies:  upstreamDependencies,
    downstream_risk_axes:   downstreamRiskAxes,
    execution_note:         executionNote,
    // L5.1 entity fields — null/[] when no deterministic mapping (structure-only axes)
    primary_entity:    entityResult.primary,
    affected_entities: entityResult.affected,
    preserve_entities: entityResult.preserve,
    // Phase 5: affected_scenes — [] when no scene_spine_links rows for this axis
    affected_scenes: affectedScenes,
  };
}

/**
 * Builds an ordered list of patch blueprints from all rewrite targets.
 *
 * If rewrite_targets have been sequenced (NDG v3), blueprints are returned
 * in ascending sequence_rank order (safest repair order).
 * If no sequence metadata exists, the original target order is preserved.
 *
 * Returns [] when rewriteTargets is empty (no error).
 *
 * @param rewriteTargets  Enriched, NDG v3-sequenced rewrite targets
 * @param preserveTargets All preserve_targets (for constraints)
 * @param propagatedRisk  Propagated risk from NDG planner
 * @param entityContext   Optional NIT entity context for L5.1 entity enrichment.
 *                        If null/absent, entity fields will be null/[] on all blueprints.
 * @param sceneContext    Optional scene context for Phase 5 affected_scenes enrichment.
 *                        If null/absent, affected_scenes will be [] on all blueprints.
 */
export function buildPatchBlueprints(
  rewriteTargets: any[],
  preserveTargets: any[],
  propagatedRisk: PropagatedRisk[],
  entityContext?: EntityContext | null,
  sceneContext?: SceneContext | null,
): PatchBlueprint[] {
  if (!rewriteTargets || rewriteTargets.length === 0) return [];

  // Build rewrite axis set for upstream dependency filtering
  const rewriteAxisSet = new Set<SpineAxis>(rewriteTargets.map(rt => rt.axis as SpineAxis));

  // Sort by sequence_rank if available (NDG v3), else preserve original order
  const ordered = [...rewriteTargets].sort((a, b) => {
    const aRank = a.sequence_rank ?? Infinity;
    const bRank = b.sequence_rank ?? Infinity;
    return aRank - bRank;
  });

  return ordered.map(rt =>
    buildPatchBlueprint(rt, preserveTargets, propagatedRisk, rewriteAxisSet, entityContext, sceneContext)
  );
}
