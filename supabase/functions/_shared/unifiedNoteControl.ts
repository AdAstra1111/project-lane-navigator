/**
 * Unified Note Control — Read Model
 *
 * Normalizes blockers from all three note systems into a single
 * deterministic control surface for pipeline gates and prompt injection.
 *
 * Tables:
 *  1. project_deferred_notes  — source_doc_type → target_deliverable_type
 *  2. project_notes           — doc_type (source) → destination_doc_type (target)
 *  3. project_dev_note_state  — doc_type (source) → defer_to_doc_type (target)
 *
 * This is READ-ONLY normalization — no schema changes.
 */

import { type LaneKey } from "./documentLadders.ts";
import { getInvalidationPlan, type InvalidationPlan } from "./deliverableDependencyRegistry.ts";

// ── Phase 3: Subject Propagation Result ──
export interface SubjectPropagationResult {
  deltas_count: number;
  affected_doc_types: string[];
  unaffected_doc_types: string[];
  narrowing_ratio: number;
  subject_classes: string[];
  delta_details: { subject_id: string; delta_type: string; label: string }[];
}

export interface UnifiedBlocker {
  id: string;
  source_table: "project_deferred_notes" | "project_notes" | "project_dev_note_state";
  source_doc_type: string | null;
  target_doc_type: string;
  severity: string;
  category: string | null;
  title: string;
  summary: string;
  note_key_or_fingerprint: string;
  blocking_reason: string;
}

export interface UnifiedBlockerOptions {
  /** Severity values that count as blocking. Default: ["blocker","high"] */
  blockingSeverities?: string[];
  /** Max results per table. Default: 25 */
  limitPerTable?: number;
  /** Include project_notes system. Default: true */
  includeProjectNotes?: boolean;
  /** Include project_dev_note_state system. Default: true */
  includeDevNoteState?: boolean;
}

const DEFAULT_BLOCKING_SEVERITIES = ["blocker", "high"];
const UNRESOLVED_DEFERRED_STATUSES = ["open", "pinned"];
const UNRESOLVED_NOTE_STATUSES = ["open", "in_progress", "reopened"];
const UNRESOLVED_DEV_NOTE_STATUSES = ["open"];

/**
 * Get all unresolved upstream note blockers targeting a specific doc type,
 * normalized across all three note systems.
 */
export async function getUnifiedUpstreamNoteBlockers(
  supabase: any,
  projectId: string,
  targetDocType: string,
  options?: UnifiedBlockerOptions,
): Promise<UnifiedBlocker[]> {
  const blockingSeverities = options?.blockingSeverities ?? DEFAULT_BLOCKING_SEVERITIES;
  const limitPerTable = options?.limitPerTable ?? 25;
  const includeProjectNotes = options?.includeProjectNotes ?? true;
  const includeDevNoteState = options?.includeDevNoteState ?? true;

  const blockers: UnifiedBlocker[] = [];
  const seenKeys = new Set<string>();

  // ── 1. project_deferred_notes ──
  try {
    const { data: deferred } = await supabase
      .from("project_deferred_notes")
      .select("id, note_key, source_doc_type, target_deliverable_type, severity, category, note_json, pinned")
      .eq("project_id", projectId)
      .eq("target_deliverable_type", targetDocType)
      .in("status", UNRESOLVED_DEFERRED_STATUSES)
      .in("severity", blockingSeverities)
      .limit(limitPerTable);

    for (const n of deferred || []) {
      const desc = n.note_json?.description || n.note_json?.note || n.note_key || "";
      const key = `deferred::${n.note_key || n.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      blockers.push({
        id: n.id,
        source_table: "project_deferred_notes",
        source_doc_type: n.source_doc_type,
        target_doc_type: targetDocType,
        severity: n.severity || "high",
        category: n.category,
        title: desc.slice(0, 120),
        summary: desc,
        note_key_or_fingerprint: n.note_key || n.id,
        blocking_reason: `Unresolved deferred note from ${n.source_doc_type || "unknown"} targeting ${targetDocType}`,
      });
    }
  } catch (e: any) {
    console.warn("[unified-note-control] project_deferred_notes query failed:", e?.message);
  }

  // ── 2. project_notes ──
  if (includeProjectNotes) {
    try {
      const { data: notes } = await supabase
        .from("project_notes")
        .select("id, doc_type, destination_doc_type, status, severity, category, timing, title, summary, legacy_key")
        .eq("project_id", projectId)
        .eq("destination_doc_type", targetDocType)
        .in("status", UNRESOLVED_NOTE_STATUSES)
        .in("severity", blockingSeverities)
        .limit(limitPerTable);

      for (const n of notes || []) {
        // Dedupe: check if same legacy_key already covered by deferred notes
        const dedupeKey = n.legacy_key ? `legacy::${n.legacy_key}` : `note::${n.id}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        // Only include notes with timing=now or timing=later that target this doc
        if (n.timing && n.timing !== "now" && n.timing !== "later") continue;

        blockers.push({
          id: n.id,
          source_table: "project_notes",
          source_doc_type: n.doc_type,
          target_doc_type: targetDocType,
          severity: n.severity || "high",
          category: n.category,
          title: n.title || "",
          summary: n.summary || "",
          note_key_or_fingerprint: n.legacy_key || n.id,
          blocking_reason: `Unresolved canonical note from ${n.doc_type || "unknown"} targeting ${targetDocType}`,
        });
      }
    } catch (e: any) {
      console.warn("[unified-note-control] project_notes query failed:", e?.message);
    }
  }

  // ── 3. project_dev_note_state ──
  if (includeDevNoteState) {
    try {
      const { data: devNotes } = await supabase
        .from("project_dev_note_state")
        .select("id, doc_type, defer_to_doc_type, status, severity, tier, note_fingerprint, objective")
        .eq("project_id", projectId)
        .eq("defer_to_doc_type", targetDocType)
        .in("status", UNRESOLVED_DEV_NOTE_STATUSES)
        .limit(limitPerTable);

      for (const n of devNotes || []) {
        // Map numeric severity to string for comparison
        const sevNum = typeof n.severity === "number" ? n.severity : 0;
        const sevStr = n.tier === "blocker" ? "blocker" : (sevNum >= 0.7 ? "high" : sevNum >= 0.4 ? "med" : "low");
        if (!blockingSeverities.includes(sevStr) && !blockingSeverities.includes(n.tier || "")) continue;

        const dedupeKey = `devnote::${n.note_fingerprint}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);

        blockers.push({
          id: n.id,
          source_table: "project_dev_note_state",
          source_doc_type: n.doc_type,
          target_doc_type: targetDocType,
          severity: sevStr,
          category: null,
          title: n.objective || n.note_fingerprint || "",
          summary: n.objective || `Dev note deferred to ${targetDocType}`,
          note_key_or_fingerprint: n.note_fingerprint,
          blocking_reason: `Unresolved dev note from ${n.doc_type || "unknown"} deferred to ${targetDocType}`,
        });
      }
    } catch (e: any) {
      console.warn("[unified-note-control] project_dev_note_state query failed:", e?.message);
    }
  }

  // ── IEL Logging ──
  const byTable = {
    project_deferred_notes: blockers.filter(b => b.source_table === "project_deferred_notes").length,
    project_notes: blockers.filter(b => b.source_table === "project_notes").length,
    project_dev_note_state: blockers.filter(b => b.source_table === "project_dev_note_state").length,
  };

  console.log(`[unified-note-control] getUnifiedUpstreamNoteBlockers { project_id: "${projectId}", target_doc_type: "${targetDocType}", total_blockers: ${blockers.length}, by_table: ${JSON.stringify(byTable)}, deduped_keys: ${seenKeys.size} }`);

  return blockers;
}

/**
 * Get downstream doc types that depend on the given doc type,
 * using the lane-specific ladder. Returns all ladder stages AFTER
 * the given doc type.
 */
export function getDownstreamDocTypes(
  repairedDocType: string,
  ladder: string[],
): string[] {
  const idx = ladder.indexOf(repairedDocType);
  if (idx < 0) return [];
  return ladder.slice(idx + 1);
}

/**
 * Invalidate downstream documents after an upstream repair.
 *
 * Phase 2B: Uses the dependency registry for precise invalidation.
 * Only docs with invalidation_policy="stale" get marked stale.
 * Docs with invalidation_policy="review_only" get a soft marker.
 * Docs with invalidation_policy="none" are skipped entirely.
 *
 * Falls back to ladder-only slicing ONLY if the lane has no registry entries
 * (logged explicitly as a fallback).
 *
 * Returns { invalidatedDocs, affectedJobs, plan } with provenance.
 */
export async function invalidateDescendants(
  supabase: any,
  projectId: string,
  repairedDocType: string,
  ladder: string[],
  newVersionId: string,
  lane?: LaneKey,
): Promise<{ invalidatedDocs: string[]; affectedJobIds: string[]; plan?: InvalidationPlan; subjectPropagation?: SubjectPropagationResult }> {
  // ── Build dependency-aware invalidation plan ──
  const effectiveLane: LaneKey = lane || "unspecified";
  const plan = getInvalidationPlan(effectiveLane, repairedDocType);

  // If plan has no entries AND ladder has downstream docs, this is unexpected — log it
  if (plan.entries.length === 0) {
    const ladderDownstream = getDownstreamDocTypes(repairedDocType, ladder);
    if (ladderDownstream.length > 0) {
      console.warn(`[unified-note-control] invalidateDescendants: dependency registry returned 0 entries but ladder has ${ladderDownstream.length} downstream docs for ${repairedDocType} in lane ${effectiveLane}. Skipping invalidation — no dependency edges defined.`);
    }
    return { invalidatedDocs: [], affectedJobIds: [], plan };
  }

  // ── PHASE 3: Subject-level propagation narrowing ──
  //
  // ACTIVATION STATUS (Phase 3B canon-sync bridge implemented):
  // Canon sync is now performed in notes-engine apply_change_plan BEFORE this
  // invalidation call. When a safe source doc (concept_brief, format_rules,
  // character_bible) is repaired, canonSyncRegistry extracts a canon patch and
  // updates project_canon.canon_json, triggering auto_version_canon() to create
  // a new version row. This means the current and previous canon snapshots
  // fetched below will now reflect the repair, producing non-empty subject deltas.
  //
  // Active classes: format_rule, concept_claim, character_fact, relationship_fact.
  // Excluded: season_arc_obligation (index identity — order-fragile).
  let subjectPropagation: SubjectPropagationResult | undefined;
  let subjectNarrowedDocTypes: Set<string> | null = null;
  try {
    const {
      isSubjectSourceDocType,
      buildSubjectPropagationPlan,
      extractCanonicalSubjects,
    } = await import("./canonSubjectRegistry.ts");

    if (isSubjectSourceDocType(repairedDocType)) {
      // Fetch current and previous canon snapshots
      const { data: canonRow } = await supabase
        .from("project_canon")
        .select("canon_json")
        .eq("project_id", projectId)
        .maybeSingle();

      if (canonRow?.canon_json) {
        // Fetch the most recent approved canon version (prior state) for delta comparison
        const { data: prevVersion } = await supabase
          .from("project_canon_versions")
          .select("canon_json")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false })
          .limit(2);

        // Use the second-most-recent version as "previous" (first is the current update)
        const prevCanon = (prevVersion && prevVersion.length >= 2)
          ? prevVersion[1].canon_json || {}
          : {};
        const currentCanon = canonRow.canon_json;

        const propagationPlan = buildSubjectPropagationPlan(
          prevCanon, currentCanon, repairedDocType, effectiveLane,
        );

        if (propagationPlan && propagationPlan.deltas.length > 0) {
          const affectedDocTypes = Object.keys(propagationPlan.affected_projections);
          subjectNarrowedDocTypes = new Set(affectedDocTypes);

          subjectPropagation = {
            deltas_count: propagationPlan.deltas.length,
            affected_doc_types: affectedDocTypes,
            unaffected_doc_types: propagationPlan.unaffected_doc_types,
            narrowing_ratio: propagationPlan.narrowing_ratio,
            subject_classes: [...new Set(propagationPlan.deltas.map(d => d.subject_class))],
            delta_details: propagationPlan.deltas.map(d => ({
              subject_id: d.subject_id,
              delta_type: d.delta_type,
              label: d.label,
            })),
          };

          console.log(`[unified-note-control][Phase3] subject_propagation_computed { project: "${projectId}", repaired: "${repairedDocType}", deltas: ${propagationPlan.deltas.length}, affected: ${JSON.stringify(affectedDocTypes)}, unaffected: ${JSON.stringify(propagationPlan.unaffected_doc_types)}, narrowing: ${propagationPlan.narrowing_ratio} }`);
        } else {
          console.log(`[unified-note-control][Phase3] subject_propagation_no_deltas { project: "${projectId}", repaired: "${repairedDocType}" }`);
        }
      }
    }
  } catch (subjErr: any) {
    // Fail closed: subject propagation error does NOT block doc-level invalidation
    console.warn(`[unified-note-control][Phase3] subject_propagation_error: ${subjErr?.message}`);
  }

  const invalidatedDocs: string[] = [];
  const affectedJobIds: string[] = [];

  // ── 1. Apply invalidation per dependency plan entry ──
  // Phase 3 narrowing: if subject propagation computed affected projections,
  // skip hard invalidation for doc types NOT in the affected set.
  // This narrows the blast radius from doc-level to subject-level.
  for (const entry of plan.entries) {
    // Subject-level narrowing: if we have subject data and this doc type
    // is NOT affected by any subject delta, downgrade stale → review_only
    let effectivePolicy = entry.invalidation_policy;
    if (subjectNarrowedDocTypes && !subjectNarrowedDocTypes.has(entry.doc_type)) {
      if (effectivePolicy === "stale") {
        effectivePolicy = "review_only";
        console.log(`[unified-note-control][Phase3] subject_narrowing_downgrade: ${entry.doc_type} stale→review_only (not in subject projection targets)`);
      }
    }
    try {
      const { data: docs } = await supabase
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", entry.doc_type);

      if (!docs || docs.length === 0) continue;

      for (const doc of docs) {
        if (effectivePolicy === "stale") {
          // Hard invalidation — mark stale
          const { data: updated, error } = await supabase
            .from("project_document_versions")
            .update({
              depends_on_resolver_hash: `invalidated_by_upstream_repair_${repairedDocType}_${newVersionId.slice(0, 8)}`,
              is_stale: true,
              stale_reason: "upstream_repair",
            })
            .eq("document_id", doc.id)
            .eq("is_current", true)
            .select("id");

          if (!error && updated && updated.length > 0) {
            invalidatedDocs.push(entry.doc_type);
          }
        } else if (effectivePolicy === "review_only") {
          // Soft invalidation — mark for review without forcing regen
          const { data: updated, error } = await supabase
            .from("project_document_versions")
            .update({
              depends_on_resolver_hash: `review_suggested_after_${repairedDocType}_${newVersionId.slice(0, 8)}`,
              // Do NOT set is_stale=true for review_only — just change the hash to flag review
            })
            .eq("document_id", doc.id)
            .eq("is_current", true)
            .select("id");

          if (!error && updated && updated.length > 0) {
            invalidatedDocs.push(entry.doc_type);
          }
        }
        // invalidation_policy === "none" → skip entirely
      }
    } catch (e: any) {
      console.warn(`[unified-note-control] invalidateDescendants: error invalidating ${entry.doc_type}:`, e?.message);
    }
  }

  // ── 2. Reset auto_run_jobs for docs that need reanalysis ──
  const reanalyzeDocs = plan.entries
    .filter(e => e.revalidation_policy === "must_reanalyze")
    .map(e => e.doc_type);

  if (reanalyzeDocs.length > 0) {
    try {
      const { data: activeJobs } = await supabase
        .from("auto_run_jobs")
        .select("id, current_document")
        .eq("project_id", projectId)
        .in("status", ["running", "paused"])
        .in("current_document", reanalyzeDocs);

      if (activeJobs && activeJobs.length > 0) {
        for (const job of activeJobs) {
          await supabase
            .from("auto_run_jobs")
            .update({
              last_analyzed_version_id: null,
              last_ui_message: `Upstream repair on ${repairedDocType} — re-analysis required`,
            })
            .eq("id", job.id);
          affectedJobIds.push(job.id);
        }
      }
    } catch (e: any) {
      console.warn("[unified-note-control] invalidateDescendants: error resetting jobs:", e?.message);
    }
  }

  console.log(`[unified-note-control] invalidateDescendants { project_id: "${projectId}", repaired_doc_type: "${repairedDocType}", lane: "${effectiveLane}", invalidated_docs: ${JSON.stringify(invalidatedDocs)}, skipped_docs: ${JSON.stringify(plan.skipped_doc_types)}, affected_jobs: ${JSON.stringify(affectedJobIds)}, plan_entries: ${plan.entries.length}, subject_propagation: ${subjectPropagation ? `deltas=${subjectPropagation.deltas_count},narrowing=${subjectPropagation.narrowing_ratio}` : "none"} }`);

  return { invalidatedDocs, affectedJobIds, plan, subjectPropagation };
}
