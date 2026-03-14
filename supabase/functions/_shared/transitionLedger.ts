/**
 * transitionLedger.ts — Centralized Transition Ledger emission utility.
 * 
 * ALL critical pipeline mutations MUST emit transitions through this utility.
 * Provides:
 * - Consistent payload normalization
 * - Explicit event typing
 * - Fail-closed mode for critical operations
 * - Structured logging alongside persistence
 * 
 * IMMUTABILITY: pipeline_transitions rows are append-only (DB triggers prevent UPDATE/DELETE).
 * FAIL-CLOSED: Critical transitions throw if persistence fails.
 */

// ── Event Type Registry ──
// v1.1 transition types — extend as needed in future phases.
export const TRANSITION_EVENTS = {
  // Version lifecycle
  VERSION_CREATED: "version_created",
  VERSION_APPROVED: "version_approved",
  VERSION_SUPERSEDED: "version_superseded",
  AUTHORITATIVE_VERSION_RESOLVED: "authoritative_version_resolved",

  // Stage transitions
  STAGE_TRANSITION_EXECUTED: "stage_transition_executed",
  PROMOTION_GATE_EVALUATED: "promotion_gate_evaluated",

  // Auto-Run lifecycle
  AUTO_RUN_STEP_STARTED: "auto_run_step_started",
  AUTO_RUN_STEP_COMPLETED: "auto_run_step_completed",
  AUTO_RUN_STEP_FAILED: "auto_run_step_failed",

  // Scoring
  CI_GP_SCORES_COMPUTED: "ci_gp_scores_computed",

  // Rewrite
  REWRITE_PASS_EXECUTED: "rewrite_pass_executed",
  REWRITE_PASS_FAILED: "rewrite_pass_failed",

  // Analysis
  ANALYSIS_RUN_COMPLETED: "analysis_run_completed",

  // Canon / Decisions
  CANON_UNITS_PERSISTED: "canon_units_persisted",
  DECISION_LOCKED: "decision_locked",
  DECISION_PROPAGATED: "decision_propagated",

  // Gate outcomes
  STALE_GATE_STATE_INVALIDATED: "stale_gate_state_invalidated",
  PROMOTION_GATE_VERSION_MISMATCH: "promotion_gate_version_mismatch",

  // Impact Engine v2
  IMPACT_ANALYSIS_COMPLETED: "impact_analysis_completed",
  AFFECTED_DOCUMENT_IDENTIFIED: "affected_document_identified",
  BOUNDED_REPAIR_PLANNED: "bounded_repair_planned",
  IMPACT_REPAIR_BLOCKED: "impact_repair_blocked",

  // Projection Execution Layer
  PROJECTION_EXECUTION_VALIDATED: "projection_execution_validated",
  PROJECTION_EXECUTION_BLOCKED: "projection_execution_blocked",
  PROJECTION_EXECUTION_STARTED: "projection_execution_started",
  PROJECTION_EXECUTION_COMPLETED: "projection_execution_completed",
  PROJECTION_EXECUTION_FAILED: "projection_execution_failed",

  // Narrative Integrity Validation
  NARRATIVE_VALIDATION_STARTED: "narrative_validation_started",
  NARRATIVE_VALIDATION_COMPLETED: "narrative_validation_completed",
  NARRATIVE_VALIDATION_BLOCKED: "narrative_validation_blocked",
  NARRATIVE_VIOLATION_DETECTED: "narrative_violation_detected",

  // Validation-to-Issue/Planning Handoff
  VALIDATION_HANDOFF_REQUESTED: "validation_handoff_requested",
  VALIDATION_HANDOFF_CLASSIFIED: "validation_handoff_classified",
  VALIDATION_HANDOFF_BLOCKED: "validation_handoff_blocked",
  VALIDATION_ISSUE_CREATED: "validation_issue_created",
  VALIDATION_HANDOFF_DUPLICATE_SUPPRESSED: "validation_handoff_duplicate_suppressed",

  // Manual Review Queue Bridge
  VALIDATION_REVIEW_TASK_CREATED: "validation_review_task_created",
  VALIDATION_REVIEW_DUPLICATE_SUPPRESSED: "validation_review_duplicate_suppressed",
  VALIDATION_REVIEW_BLOCKED: "validation_review_blocked",

  // Validation-to-Planning Handoff
  VALIDATION_PLANNING_HANDOFF_REQUESTED: "validation_planning_handoff_requested",
  VALIDATION_PLANNING_HANDOFF_CLASSIFIED: "validation_planning_handoff_classified",
  VALIDATION_PLANNING_HANDOFF_BLOCKED: "validation_planning_handoff_blocked",
  VALIDATION_PLANNING_REQUEST_CREATED: "validation_planning_request_created",
  VALIDATION_PLANNING_DUPLICATE_SUPPRESSED: "validation_planning_duplicate_suppressed",

  // Patch Execution Replay
  PATCH_EXECUTION_COMPLETED: "patch_execution_completed",
} as const;

export type TransitionEventType = typeof TRANSITION_EVENTS[keyof typeof TRANSITION_EVENTS];

// ── Event Domain Registry ──
export const EVENT_DOMAINS = {
  VERSION: "version",
  STAGE: "stage",
  AUTO_RUN: "auto_run",
  SCORING: "scoring",
  REWRITE: "rewrite",
  ANALYSIS: "analysis",
  CANON: "canon",
  DECISION: "decision",
  GATE: "gate",
} as const;

// ── Transition Payload ──
export interface TransitionPayload {
  projectId: string;
  eventType: TransitionEventType | string;
  eventDomain?: string;
  status?: "completed" | "failed" | "intent" | "skipped";

  // State context
  docType?: string;
  stage?: string;
  lane?: string;

  // Version binding
  sourceVersionId?: string;
  resultingVersionId?: string;

  // Correlation
  jobId?: string;
  runId?: string;
  analysisRunId?: string;
  decisionId?: string;

  // State snapshots
  previousState?: Record<string, unknown>;
  resultingState?: Record<string, unknown>;

  // Trigger/source
  trigger?: string;
  sourceOfTruth?: string;
  generatorId?: string;

  // Scores
  ci?: number;
  gp?: number;
  gap?: number;

  // Audit
  createdBy?: string;
}

// ── Criticality: events where failure MUST block the mutation ──
const CRITICAL_EVENTS = new Set<string>([
  TRANSITION_EVENTS.VERSION_CREATED,
  TRANSITION_EVENTS.STAGE_TRANSITION_EXECUTED,
  TRANSITION_EVENTS.REWRITE_PASS_EXECUTED,
  TRANSITION_EVENTS.VERSION_APPROVED,
  TRANSITION_EVENTS.AUTHORITATIVE_VERSION_RESOLVED,
  TRANSITION_EVENTS.PROMOTION_GATE_EVALUATED,
]);

/**
 * Emit a transition event to the pipeline_transitions table.
 * 
 * For CRITICAL events: throws if persistence fails (fail-closed).
 * For non-critical events: logs warning and continues (fail-open).
 * 
 * @param supabase - Supabase client (service-role or authenticated)
 * @param payload - Transition event payload
 * @param options - { critical?: boolean } override default criticality
 */
export async function emitTransition(
  supabase: any,
  payload: TransitionPayload,
  options?: { critical?: boolean }
): Promise<string | null> {
  const isCritical = options?.critical ?? CRITICAL_EVENTS.has(payload.eventType);

  const row = {
    project_id: payload.projectId,
    event_type: payload.eventType,
    event_domain: payload.eventDomain || inferDomain(payload.eventType),
    status: payload.status || "completed",
    doc_type: payload.docType || null,
    stage: payload.stage || null,
    lane: payload.lane || null,
    source_version_id: payload.sourceVersionId || null,
    resulting_version_id: payload.resultingVersionId || null,
    job_id: payload.jobId || null,
    run_id: payload.runId || null,
    analysis_run_id: payload.analysisRunId || null,
    decision_id: payload.decisionId || null,
    previous_state: payload.previousState || {},
    resulting_state: payload.resultingState || {},
    trigger: payload.trigger || null,
    source_of_truth: payload.sourceOfTruth || null,
    generator_id: payload.generatorId || null,
    ci: payload.ci ?? null,
    gp: payload.gp ?? null,
    gap: payload.gap ?? null,
    created_by: payload.createdBy || null,
  };

  // Structured log (always emitted for observability)
  console.log(`[transition-ledger] ${payload.eventType}`, JSON.stringify({
    project_id: payload.projectId,
    event_type: payload.eventType,
    domain: row.event_domain,
    status: row.status,
    doc_type: row.doc_type,
    stage: row.stage,
    job_id: row.job_id,
    source_version_id: row.source_version_id,
    resulting_version_id: row.resulting_version_id,
    ci: row.ci,
    gp: row.gp,
    trigger: row.trigger,
    critical: isCritical,
  }));

  try {
    const { data, error } = await supabase
      .from("pipeline_transitions")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      const msg = `[transition-ledger] PERSIST_FAILED event=${payload.eventType} project=${payload.projectId}: ${error.message}`;
      if (isCritical) {
        console.error(msg);
        throw new Error(`TRANSITION_PERSIST_FAILED: ${payload.eventType} — ${error.message}`);
      }
      console.warn(msg);
      return null;
    }

    return data?.id || null;
  } catch (err: any) {
    if (err?.message?.startsWith("TRANSITION_PERSIST_FAILED:")) throw err;
    const msg = `[transition-ledger] PERSIST_ERROR event=${payload.eventType}: ${err?.message}`;
    if (isCritical) {
      console.error(msg);
      throw new Error(`TRANSITION_PERSIST_FAILED: ${payload.eventType} — ${err?.message}`);
    }
    console.warn(msg);
    return null;
  }
}

/**
 * Batch emit multiple transitions (non-critical by default).
 */
export async function emitTransitions(
  supabase: any,
  payloads: TransitionPayload[],
): Promise<void> {
  for (const p of payloads) {
    await emitTransition(supabase, p, { critical: false });
  }
}

/**
 * Query transitions for replay / audit.
 */
export async function queryTransitions(
  supabase: any,
  filters: {
    projectId: string;
    jobId?: string;
    eventType?: string;
    docType?: string;
    limit?: number;
  }
): Promise<any[]> {
  let query = supabase
    .from("pipeline_transitions")
    .select("*")
    .eq("project_id", filters.projectId)
    .order("created_at", { ascending: true });

  if (filters.jobId) query = query.eq("job_id", filters.jobId);
  if (filters.eventType) query = query.eq("event_type", filters.eventType);
  if (filters.docType) query = query.eq("doc_type", filters.docType);
  query = query.limit(filters.limit || 200);

  const { data, error } = await query;
  if (error) {
    console.warn(`[transition-ledger] query failed: ${error.message}`);
    return [];
  }
  return data || [];
}

// ── Domain inference from event type ──
function inferDomain(eventType: string): string {
  if (eventType.startsWith("version_") || eventType.startsWith("authoritative_")) return EVENT_DOMAINS.VERSION;
  if (eventType.startsWith("stage_")) return EVENT_DOMAINS.STAGE;
  if (eventType.startsWith("auto_run_")) return EVENT_DOMAINS.AUTO_RUN;
  if (eventType.startsWith("ci_gp_") || eventType.startsWith("scoring_")) return EVENT_DOMAINS.SCORING;
  if (eventType.startsWith("rewrite_")) return EVENT_DOMAINS.REWRITE;
  if (eventType.startsWith("analysis_")) return EVENT_DOMAINS.ANALYSIS;
  if (eventType.startsWith("canon_")) return EVENT_DOMAINS.CANON;
  if (eventType.startsWith("decision_")) return EVENT_DOMAINS.DECISION;
  if (eventType.startsWith("promotion_") || eventType.startsWith("stale_")) return EVENT_DOMAINS.GATE;
  if (eventType.startsWith("impact_") || eventType.startsWith("affected_") || eventType.startsWith("bounded_")) return "impact";
  if (eventType.startsWith("projection_")) return "projection";
  if (eventType.startsWith("narrative_")) return "validation";
  if (eventType.startsWith("validation_")) return "validation";
  return "pipeline";
}
