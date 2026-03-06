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
 * Resets depends_on_resolver_hash and clears last_analyzed_version_id
 * on auto_run_jobs targeting affected docs.
 *
 * Returns { invalidatedDocs, affectedJobs } counts.
 */
export async function invalidateDescendants(
  supabase: any,
  projectId: string,
  repairedDocType: string,
  ladder: string[],
  newVersionId: string,
): Promise<{ invalidatedDocs: string[]; affectedJobIds: string[] }> {
  const downstream = getDownstreamDocTypes(repairedDocType, ladder);
  if (downstream.length === 0) {
    console.log(`[unified-note-control] invalidateDescendants: no downstream docs for ${repairedDocType} in ladder`);
    return { invalidatedDocs: [], affectedJobIds: [] };
  }

  const invalidatedDocs: string[] = [];
  const affectedJobIds: string[] = [];

  // ── 1. Find downstream documents and reset their current version's resolver hash ──
  for (const docType of downstream) {
    try {
      const { data: docs } = await supabase
        .from("project_documents")
        .select("id")
        .eq("project_id", projectId)
        .eq("doc_type", docType);

      if (!docs || docs.length === 0) continue;

      for (const doc of docs) {
        // Reset resolver hash on the current version to force staleness
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
          invalidatedDocs.push(docType);
        }
      }
    } catch (e: any) {
      console.warn(`[unified-note-control] invalidateDescendants: error invalidating ${docType}:`, e?.message);
    }
  }

  // ── 2. Reset last_analyzed_version_id on active auto_run_jobs for downstream docs ──
  try {
    const { data: activeJobs } = await supabase
      .from("auto_run_jobs")
      .select("id, current_document")
      .eq("project_id", projectId)
      .in("status", ["running", "paused"])
      .in("current_document", downstream);

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

  console.log(`[unified-note-control] invalidateDescendants { project_id: "${projectId}", repaired_doc_type: "${repairedDocType}", downstream_types: ${JSON.stringify(downstream)}, invalidated_docs: ${JSON.stringify(invalidatedDocs)}, affected_jobs: ${JSON.stringify(affectedJobIds)} }`);

  return { invalidatedDocs, affectedJobIds };
}
