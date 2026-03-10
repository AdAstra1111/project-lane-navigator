/**
 * patchBlueprintEngine.ts — L5: Deterministic Patch Blueprint Generation
 *
 * Converts enriched rewrite_targets (NDG v1–v3 metadata included) into structured
 * repair instructions that tell a producer (or future execution engine) exactly what
 * kind of repair should be made, without performing it.
 *
 * Constraints:
 *   - No LLM calls. No text generation. No speculative inference.
 *   - No document mutation. No lifecycle state changes.
 *   - No extra DB queries. Uses only already-available planner metadata.
 *   - All wording is templated and deterministic.
 *   - Fail-safe: missing fields are omitted or given safe fallback values.
 */

import { type SpineAxis, AXIS_METADATA } from "./narrativeSpine.ts";
import { getUpstreamAxes, type PropagatedRisk } from "./narrativeDependencyGraph.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export type PatchUrgency = "critical" | "high" | "medium" | "low";

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

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Builds a PatchBlueprint for a single enriched rewrite_target.
 *
 * @param rt              Enriched rewrite_target (includes NDG v1–v3 metadata)
 * @param preserveTargets All preserve_targets from the current plan (for constraints)
 * @param propagatedRisk  Propagated risk array from NDG planner (for downstream axes)
 * @param rewriteAxisSet  Set of all axes in the current rewrite target list (for upstream filtering)
 */
export function buildPatchBlueprint(
  rt: any,
  preserveTargets: any[],
  propagatedRisk: PropagatedRisk[],
  rewriteAxisSet: Set<SpineAxis>,
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
 */
export function buildPatchBlueprints(
  rewriteTargets: any[],
  preserveTargets: any[],
  propagatedRisk: PropagatedRisk[],
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
    buildPatchBlueprint(rt, preserveTargets, propagatedRisk, rewriteAxisSet)
  );
}
