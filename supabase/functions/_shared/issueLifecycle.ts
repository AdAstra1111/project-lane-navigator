/**
 * Unified Issue Lifecycle Engine — Phase 2A
 *
 * Deterministic orchestration layer over the three note systems:
 *   1. project_deferred_notes
 *   2. project_notes
 *   3. project_dev_note_state
 *
 * Provides: normalization, routing, ownership, repair tracking,
 * descendant invalidation tracking, revalidation, terminal states.
 *
 * NO SCHEMA DRIFT — pure orchestration over existing tables.
 */

// ── Normalized Lifecycle States ──────────────────────────────────────────

export type NormalizedStatus =
  | "detected"
  | "active"
  | "routed"
  | "repair_required"
  | "advisory"
  | "waived"
  | "repair_queued"
  | "repair_applied"
  | "descendants_invalidated"
  | "revalidated"
  | "resolved";

export type RepairMode =
  | "upstream_repair_required"
  | "local_repair_allowed"
  | "advisory_only"
  | "waived"
  | "unknown";

export type SourceTable =
  | "project_deferred_notes"
  | "project_notes"
  | "project_dev_note_state";

// ── Normalized Issue Record ──────────────────────────────────────────────

export interface UnifiedIssue {
  source_table: SourceTable;
  source_row_id: string;
  project_id: string;
  source_doc_type: string | null;
  target_doc_type: string | null;
  owning_doc_type: string | null;
  severity: string;
  severity_numeric: number;
  category: string | null;
  status_raw: string;
  status_normalized: NormalizedStatus;
  repair_mode: RepairMode;
  note_key_or_fingerprint: string;
  title: string;
  summary: string;
  resolution_version_id: string | null;
  descendant_invalidation_state: "none" | "pending" | "done" | null;
  revalidation_state: "none" | "pending" | "pass" | "fail" | null;
  blocking: boolean;
  provenance: Record<string, unknown>;
}

// ── Status Mapping Tables ────────────────────────────────────────────────
//
// Deterministic, explicit mapping from each source table's raw statuses
// to the normalized lifecycle. No implicit logic.

const DEFERRED_STATUS_MAP: Record<string, NormalizedStatus> = {
  open: "active",
  pinned: "active",
  resurfaced: "active",
  resolved: "resolved",
  dismissed: "waived",
};

const NOTES_STATUS_MAP: Record<string, NormalizedStatus> = {
  open: "active",
  in_progress: "repair_queued",
  reopened: "active",
  applied: "repair_applied",
  dismissed: "waived",
  deferred: "routed",
  needs_decision: "active",
};

const DEV_NOTE_STATUS_MAP: Record<string, NormalizedStatus> = {
  open: "active",
  applied: "repair_applied",
  waived: "waived",
  deferred: "routed",
  locked: "resolved",
  superseded: "resolved",
};

// ── Severity Normalization ───────────────────────────────────────────────

const SEVERITY_STRING_TO_NUMERIC: Record<string, number> = {
  blocker: 1.0,
  critical: 0.9,
  high: 0.8,
  med: 0.5,
  medium: 0.5,
  low: 0.3,
  polish: 0.2,
  info: 0.1,
};

function normalizeSeverityString(s: string | null | undefined): { str: string; num: number } {
  if (!s) return { str: "med", num: 0.5 };
  const lower = s.toLowerCase();
  if (SEVERITY_STRING_TO_NUMERIC[lower] !== undefined) {
    return { str: lower, num: SEVERITY_STRING_TO_NUMERIC[lower] };
  }
  return { str: s, num: 0.5 };
}

function normalizeSeverityNumeric(n: number, tier?: string | null): { str: string; num: number } {
  if (tier === "blocker") return { str: "blocker", num: 1.0 };
  if (n >= 0.8) return { str: "high", num: n };
  if (n >= 0.5) return { str: "med", num: n };
  if (n >= 0.3) return { str: "low", num: n };
  return { str: "polish", num: n };
}

// ── Blocking Severities ──────────────────────────────────────────────────

const BLOCKING_SEVERITIES = new Set(["blocker", "critical", "high"]);

function isBlocking(severity: string, normalized: NormalizedStatus): boolean {
  if (normalized === "resolved" || normalized === "waived" || normalized === "repair_applied") return false;
  return BLOCKING_SEVERITIES.has(severity);
}

// ── Repair Mode Classification ───────────────────────────────────────────

function classifyRepairMode(
  sourceDocType: string | null,
  targetDocType: string | null,
  severity: string,
  normalized: NormalizedStatus,
): RepairMode {
  if (normalized === "waived") return "waived";
  if (normalized === "resolved" || normalized === "repair_applied") return "waived";

  // If source and target differ, it's an upstream repair issue
  if (sourceDocType && targetDocType && sourceDocType !== targetDocType) {
    if (BLOCKING_SEVERITIES.has(severity)) return "upstream_repair_required";
    return "advisory_only";
  }

  // Same doc or no target — local repair
  if (BLOCKING_SEVERITIES.has(severity)) return "local_repair_allowed";
  return "advisory_only";
}

// ── Ownership Derivation ─────────────────────────────────────────────────

function deriveOwningDocType(
  sourceDocType: string | null,
  targetDocType: string | null,
  repairMode: RepairMode,
): string | null {
  // For upstream repairs, the owning doc is the source (where the fix goes)
  if (repairMode === "upstream_repair_required") return sourceDocType;
  // For local repairs, the owning doc is the target (or source if no target)
  return targetDocType || sourceDocType;
}

// ── Normalize Individual Records ─────────────────────────────────────────

function normalizeDeferredNote(row: any): UnifiedIssue {
  const noteJson = row.note_json || {};
  const desc = noteJson.description || noteJson.note || row.note_key || "";
  const sev = normalizeSeverityString(row.severity);
  const normalized = DEFERRED_STATUS_MAP[row.status] || "active";
  const repairMode = classifyRepairMode(row.source_doc_type, row.target_deliverable_type, sev.str, normalized);

  return {
    source_table: "project_deferred_notes",
    source_row_id: row.id,
    project_id: row.project_id,
    source_doc_type: row.source_doc_type || null,
    target_doc_type: row.target_deliverable_type || null,
    owning_doc_type: deriveOwningDocType(row.source_doc_type, row.target_deliverable_type, repairMode),
    severity: sev.str,
    severity_numeric: sev.num,
    category: row.category || noteJson.category || null,
    status_raw: row.status,
    status_normalized: normalized,
    repair_mode: repairMode,
    note_key_or_fingerprint: row.note_key || row.id,
    title: desc.slice(0, 120),
    summary: desc,
    resolution_version_id: null,
    descendant_invalidation_state: null,
    revalidation_state: null,
    blocking: isBlocking(sev.str, normalized),
    provenance: {
      pinned: row.pinned || false,
      resolution_method: row.resolution_method || null,
      source_version_id: row.source_version_id || null,
    },
  };
}

function normalizeProjectNote(row: any): UnifiedIssue {
  const sev = normalizeSeverityString(row.severity);
  const normalized = NOTES_STATUS_MAP[row.status] || "active";
  const repairMode = classifyRepairMode(row.doc_type, row.destination_doc_type, sev.str, normalized);

  // Determine descendant invalidation state from events (if applied)
  let descendantState: UnifiedIssue["descendant_invalidation_state"] = null;
  let revalidationState: UnifiedIssue["revalidation_state"] = null;

  if (normalized === "repair_applied") {
    descendantState = "pending"; // Will be refined by event query if needed
    revalidationState = "pending";
  }

  return {
    source_table: "project_notes",
    source_row_id: row.id,
    project_id: row.project_id,
    source_doc_type: row.doc_type || null,
    target_doc_type: row.destination_doc_type || null,
    owning_doc_type: deriveOwningDocType(row.doc_type, row.destination_doc_type, repairMode),
    severity: sev.str,
    severity_numeric: sev.num,
    category: row.category || null,
    status_raw: row.status,
    status_normalized: normalized,
    repair_mode: repairMode,
    note_key_or_fingerprint: row.legacy_key || row.id,
    title: row.title || "",
    summary: row.summary || "",
    resolution_version_id: row.applied_change_event_id || null,
    descendant_invalidation_state: descendantState,
    revalidation_state: revalidationState,
    blocking: isBlocking(sev.str, normalized),
    provenance: {
      timing: row.timing || null,
      source: row.source || null,
      document_id: row.document_id || null,
      version_id: row.version_id || null,
    },
  };
}

function normalizeDevNoteState(row: any): UnifiedIssue {
  const sev = normalizeSeverityNumeric(row.severity || 0, row.tier);
  const normalized = DEV_NOTE_STATUS_MAP[row.status] || "active";
  const repairMode = classifyRepairMode(row.doc_type, row.defer_to_doc_type, sev.str, normalized);

  return {
    source_table: "project_dev_note_state",
    source_row_id: row.id,
    project_id: row.project_id,
    source_doc_type: row.doc_type || null,
    target_doc_type: row.defer_to_doc_type || null,
    owning_doc_type: deriveOwningDocType(row.doc_type, row.defer_to_doc_type, repairMode),
    severity: sev.str,
    severity_numeric: sev.num,
    category: null,
    status_raw: row.status,
    status_normalized: normalized,
    repair_mode: repairMode,
    note_key_or_fingerprint: row.note_fingerprint || row.id,
    title: row.objective || row.note_fingerprint || "",
    summary: row.objective || `Dev note in ${row.doc_type || "unknown"}`,
    resolution_version_id: row.last_applied_version_id || null,
    descendant_invalidation_state: null,
    revalidation_state: null,
    blocking: isBlocking(sev.str, normalized),
    provenance: {
      tier: row.tier || null,
      times_seen: row.times_seen || 1,
      constraint_key: row.constraint_key || null,
      anchor: row.anchor || null,
      waive_reason: row.waive_reason || null,
    },
  };
}

// ── Public Normalizer ────────────────────────────────────────────────────

export function normalizeIssueRecord(sourceTable: SourceTable, row: any): UnifiedIssue {
  switch (sourceTable) {
    case "project_deferred_notes":
      return normalizeDeferredNote(row);
    case "project_notes":
      return normalizeProjectNote(row);
    case "project_dev_note_state":
      return normalizeDevNoteState(row);
  }
}

// ── Unified Issue Readers ────────────────────────────────────────────────

export interface UnifiedIssueOptions {
  /** Only return issues with these normalized statuses */
  statuses?: NormalizedStatus[];
  /** Only return blocking issues */
  blockingOnly?: boolean;
  /** Target doc type filter */
  targetDocType?: string;
  /** Source doc type filter */
  sourceDocType?: string;
  /** Max per table. Default: 100 */
  limitPerTable?: number;
  /** Include terminal states (resolved/waived). Default: false */
  includeTerminal?: boolean;
}

const ACTIVE_DEFERRED_STATUSES = ["open", "pinned", "resurfaced"];
const TERMINAL_DEFERRED_STATUSES = ["resolved", "dismissed"];
const ACTIVE_NOTES_STATUSES = ["open", "in_progress", "reopened", "needs_decision", "deferred"];
const TERMINAL_NOTES_STATUSES = ["applied", "dismissed"];
const ACTIVE_DEV_STATUSES = ["open", "deferred"];
const TERMINAL_DEV_STATUSES = ["applied", "waived", "locked", "superseded"];

export async function getUnifiedIssuesForProject(
  supabase: any,
  projectId: string,
  options?: UnifiedIssueOptions,
): Promise<UnifiedIssue[]> {
  const limit = options?.limitPerTable ?? 100;
  const includeTerminal = options?.includeTerminal ?? false;
  const issues: UnifiedIssue[] = [];

  // ── 1. project_deferred_notes ──
  try {
    const statuses = includeTerminal
      ? [...ACTIVE_DEFERRED_STATUSES, ...TERMINAL_DEFERRED_STATUSES]
      : ACTIVE_DEFERRED_STATUSES;
    let q = supabase
      .from("project_deferred_notes")
      .select("*")
      .eq("project_id", projectId)
      .in("status", statuses)
      .limit(limit);
    if (options?.targetDocType) q = q.eq("target_deliverable_type", options.targetDocType);
    if (options?.sourceDocType) q = q.eq("source_doc_type", options.sourceDocType);
    const { data } = await q;
    for (const row of data || []) {
      issues.push(normalizeDeferredNote(row));
    }
  } catch (e: any) {
    console.warn("[issue-lifecycle] project_deferred_notes query failed:", e?.message);
  }

  // ── 2. project_notes ──
  try {
    const statuses = includeTerminal
      ? [...ACTIVE_NOTES_STATUSES, ...TERMINAL_NOTES_STATUSES]
      : ACTIVE_NOTES_STATUSES;
    let q = supabase
      .from("project_notes")
      .select("*")
      .eq("project_id", projectId)
      .in("status", statuses)
      .limit(limit);
    if (options?.targetDocType) q = q.eq("destination_doc_type", options.targetDocType);
    if (options?.sourceDocType) q = q.eq("doc_type", options.sourceDocType);
    const { data } = await q;
    for (const row of data || []) {
      issues.push(normalizeProjectNote(row));
    }
  } catch (e: any) {
    console.warn("[issue-lifecycle] project_notes query failed:", e?.message);
  }

  // ── 3. project_dev_note_state ──
  try {
    const statuses = includeTerminal
      ? [...ACTIVE_DEV_STATUSES, ...TERMINAL_DEV_STATUSES]
      : ACTIVE_DEV_STATUSES;
    let q = supabase
      .from("project_dev_note_state")
      .select("*")
      .eq("project_id", projectId)
      .in("status", statuses)
      .limit(limit);
    if (options?.targetDocType) q = q.eq("defer_to_doc_type", options.targetDocType);
    if (options?.sourceDocType) q = q.eq("doc_type", options.sourceDocType);
    const { data } = await q;
    for (const row of data || []) {
      issues.push(normalizeDevNoteState(row));
    }
  } catch (e: any) {
    console.warn("[issue-lifecycle] project_dev_note_state query failed:", e?.message);
  }

  // ── Post-filter ──
  let result = issues;
  if (options?.statuses?.length) {
    const allowed = new Set(options.statuses);
    result = result.filter(i => allowed.has(i.status_normalized));
  }
  if (options?.blockingOnly) {
    result = result.filter(i => i.blocking);
  }

  // ── IEL Logging ──
  const byTable = {
    project_deferred_notes: result.filter(i => i.source_table === "project_deferred_notes").length,
    project_notes: result.filter(i => i.source_table === "project_notes").length,
    project_dev_note_state: result.filter(i => i.source_table === "project_dev_note_state").length,
  };
  const byStatus: Record<string, number> = {};
  for (const i of result) {
    byStatus[i.status_normalized] = (byStatus[i.status_normalized] || 0) + 1;
  }

  console.log(`[issue-lifecycle] getUnifiedIssuesForProject { project_id: "${projectId}", total: ${result.length}, by_table: ${JSON.stringify(byTable)}, by_status: ${JSON.stringify(byStatus)}, blocking: ${result.filter(i => i.blocking).length} }`);

  return result;
}

export async function getUnifiedIssuesForTargetDoc(
  supabase: any,
  projectId: string,
  targetDocType: string,
  options?: Omit<UnifiedIssueOptions, "targetDocType">,
): Promise<UnifiedIssue[]> {
  return getUnifiedIssuesForProject(supabase, projectId, { ...options, targetDocType });
}

// ── Lifecycle Mutation Helpers ────────────────────────────────────────────
//
// These write back to the SOURCE TABLES using the source_table + source_row_id
// from the normalized issue. They also log events to project_note_events
// where the source supports it (project_notes has events; others use console).

async function logLifecycleEvent(
  supabase: any,
  issue: Pick<UnifiedIssue, "source_table" | "source_row_id" | "project_id">,
  eventType: string,
  payload: Record<string, unknown>,
  userId: string,
) {
  // ── 1. Unified lifecycle event store (all source systems) ──
  try {
    await supabase.from("project_issue_lifecycle_events").insert({
      project_id: issue.project_id,
      source_table: issue.source_table,
      source_row_id: issue.source_row_id,
      event_type: eventType,
      payload: { ...payload, lifecycle_engine: true },
      created_by: userId,
    });
  } catch (e: any) {
    console.warn(`[issue-lifecycle] Failed to persist lifecycle event:`, e?.message);
  }

  // ── 2. Legacy backward compat: also write to project_note_events for project_notes ──
  if (issue.source_table === "project_notes") {
    try {
      await supabase.from("project_note_events").insert({
        project_id: issue.project_id,
        note_id: issue.source_row_id,
        event_type: eventType,
        payload: { ...payload, lifecycle_engine: true },
        created_by: userId,
      });
    } catch (e: any) {
      console.warn(`[issue-lifecycle] Failed to write legacy project_note_events:`, e?.message);
    }
  }

  console.log(`[issue-lifecycle] event { table: "${issue.source_table}", id: "${issue.source_row_id}", event: "${eventType}", payload: ${JSON.stringify(payload)} }`);
}

/** Mark an issue as repair-queued (in_progress on source table) */
export async function markIssueRepairQueued(
  supabase: any,
  issue: UnifiedIssue,
  userId: string,
  reason?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {};

  switch (issue.source_table) {
    case "project_deferred_notes":
      // Deferred notes don't have an "in_progress" status — keep as open, log intent
      break;
    case "project_notes":
      updates.status = "in_progress";
      updates.updated_by = userId;
      break;
    case "project_dev_note_state":
      // Dev notes don't have an in_progress — keep as open, log intent
      break;
  }

  if (Object.keys(updates).length > 0) {
    await supabase
      .from(issue.source_table)
      .update(updates)
      .eq("id", issue.source_row_id);
  }

  await logLifecycleEvent(supabase, issue, "repair_queued", { reason: reason || null }, userId);
}

/** Mark an issue as repair-applied after a successful fix */
export async function markIssueRepairApplied(
  supabase: any,
  issue: UnifiedIssue,
  userId: string,
  versionId: string,
  changeEventId?: string,
): Promise<void> {
  switch (issue.source_table) {
    case "project_deferred_notes":
      await supabase.from("project_deferred_notes").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_method: "repair_applied",
        resolution_summary: `Fix applied via lifecycle engine, version: ${versionId}`,
      }).eq("id", issue.source_row_id);
      break;
    case "project_notes":
      await supabase.from("project_notes").update({
        status: "applied",
        applied_change_event_id: changeEventId || null,
        updated_by: userId,
      }).eq("id", issue.source_row_id);
      break;
    case "project_dev_note_state":
      await supabase.from("project_dev_note_state").update({
        status: "applied",
        last_applied_version_id: versionId,
      }).eq("id", issue.source_row_id);
      break;
  }

  await logLifecycleEvent(supabase, issue, "repair_applied", {
    version_id: versionId,
    change_event_id: changeEventId || null,
  }, userId);
}

/** Mark that descendants have been invalidated after this issue's repair */
export async function markIssueDescendantsInvalidated(
  supabase: any,
  issue: UnifiedIssue,
  userId: string,
  invalidatedDocs: string[],
  affectedJobIds: string[],
): Promise<void> {
  // No source table column for this — it's tracked via events
  await logLifecycleEvent(supabase, issue, "descendants_invalidated", {
    invalidated_doc_types: invalidatedDocs,
    affected_job_ids: affectedJobIds,
  }, userId);
}

/** Mark that an issue's repair has been revalidated */
export async function markIssueRevalidated(
  supabase: any,
  issue: UnifiedIssue,
  userId: string,
  result: "pass" | "fail",
  detail?: string,
): Promise<void> {
  if (result === "fail") {
    // Reopen the issue
    switch (issue.source_table) {
      case "project_deferred_notes":
        await supabase.from("project_deferred_notes").update({
          status: "open",
          resolved_at: null,
          resolution_method: null,
          resolution_summary: null,
        }).eq("id", issue.source_row_id);
        break;
      case "project_notes":
        await supabase.from("project_notes").update({
          status: "reopened",
          updated_by: userId,
        }).eq("id", issue.source_row_id);
        break;
      case "project_dev_note_state":
        await supabase.from("project_dev_note_state").update({
          status: "open",
        }).eq("id", issue.source_row_id);
        break;
    }
  }

  await logLifecycleEvent(supabase, issue, "revalidated", { result, detail: detail || null }, userId);
}

/** Mark an issue as resolved (terminal) */
export async function markIssueResolved(
  supabase: any,
  issue: UnifiedIssue,
  userId: string,
  reason?: string,
): Promise<void> {
  switch (issue.source_table) {
    case "project_deferred_notes":
      await supabase.from("project_deferred_notes").update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_method: reason || "resolved",
        resolution_summary: reason || "Resolved via lifecycle engine",
      }).eq("id", issue.source_row_id);
      break;
    case "project_notes":
      await supabase.from("project_notes").update({
        status: "applied",
        updated_by: userId,
      }).eq("id", issue.source_row_id);
      break;
    case "project_dev_note_state":
      await supabase.from("project_dev_note_state").update({
        status: "applied",
      }).eq("id", issue.source_row_id);
      break;
  }

  await logLifecycleEvent(supabase, issue, "resolved", { reason: reason || null }, userId);
}

/** Mark an issue as waived (terminal) */
export async function markIssueWaived(
  supabase: any,
  issue: UnifiedIssue,
  userId: string,
  reason?: string,
): Promise<void> {
  switch (issue.source_table) {
    case "project_deferred_notes":
      await supabase.from("project_deferred_notes").update({
        status: "dismissed",
        resolved_at: new Date().toISOString(),
        resolution_method: "waived",
        resolution_summary: reason || "Waived via lifecycle engine",
      }).eq("id", issue.source_row_id);
      break;
    case "project_notes":
      await supabase.from("project_notes").update({
        status: "dismissed",
        updated_by: userId,
      }).eq("id", issue.source_row_id);
      break;
    case "project_dev_note_state":
      await supabase.from("project_dev_note_state").update({
        status: "waived",
        waive_reason: reason || null,
      }).eq("id", issue.source_row_id);
      break;
  }

  await logLifecycleEvent(supabase, issue, "waived", { reason: reason || null }, userId);
}

// ── "Why Blocked" Payload ────────────────────────────────────────────────

export interface WhyBlockedPayload {
  blocked: boolean;
  blocking_issues: Array<{
    source_table: SourceTable;
    source_row_id: string;
    severity: string;
    title: string;
    owning_doc_type: string | null;
    repair_mode: RepairMode;
    status_normalized: NormalizedStatus;
    next_action: string;
  }>;
  summary: string;
}

function deriveNextAction(issue: UnifiedIssue): string {
  switch (issue.repair_mode) {
    case "upstream_repair_required":
      return `Fix upstream in ${issue.owning_doc_type || "source document"}`;
    case "local_repair_allowed":
      return `Apply local fix in ${issue.target_doc_type || issue.owning_doc_type || "document"}`;
    case "advisory_only":
      return "Review advisory note (non-blocking)";
    case "waived":
      return "No action needed (waived)";
    default:
      return "Review issue";
  }
}

export async function getWhyBlocked(
  supabase: any,
  projectId: string,
  targetDocType: string,
): Promise<WhyBlockedPayload> {
  const issues = await getUnifiedIssuesForTargetDoc(supabase, projectId, targetDocType, {
    blockingOnly: true,
  });

  return {
    blocked: issues.length > 0,
    blocking_issues: issues.map(i => ({
      source_table: i.source_table,
      source_row_id: i.source_row_id,
      severity: i.severity,
      title: i.title,
      owning_doc_type: i.owning_doc_type,
      repair_mode: i.repair_mode,
      status_normalized: i.status_normalized,
      next_action: deriveNextAction(i),
    })),
    summary: issues.length === 0
      ? `No blocking issues for ${targetDocType}`
      : `${issues.length} blocking issue(s) for ${targetDocType}: ${issues.map(i => `[${i.severity}] ${i.title.slice(0, 60)}`).join("; ")}`,
  };
}
