/**
 * Validation-to-Planning Handoff v2
 *
 * Converts a tightly constrained subset of validation findings into
 * bounded planning requests compatible with the Impact Engine's
 * ChangeSource / BoundedRepairPlan interface.
 *
 * SCOPE:
 *   - Consumes planning_eligible findings from the validation handoff layer
 *   - Validates authority, lane, scope, and doc-type guards before creating requests
 *   - Produces transient PlanningRequest payloads (no new table)
 *   - Emits Transition Ledger events for audit
 *   - Does NOT execute repairs or call computeImpact
 *   - Does NOT create a second planning engine
 *
 * ARCHITECTURE:
 *   - Planning requests are ChangeSource-compatible payloads
 *   - Requests are returned transiently and recorded in Transition Ledger
 *   - Dedupe uses SHA-256 fingerprint checked against recent ledger entries
 *   - Fail-closed: blocked if authority missing, lane invalid, or scope ambiguous
 *   - No document mutation
 *   - No execution invocation
 */

import type { Violation, ValidationDomain } from "./narrativeIntegrityValidator.ts";
import type { ChangeSource, ChangeSourceKind } from "./impactEngine.ts";
import { type LaneKey, LANE_DOC_LADDERS } from "./documentLadders.ts";
import { getSectionConfig } from "./deliverableSectionRegistry.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";

// ── Planning Eligibility Guard Registry ──

/**
 * Domains + violation types that are safe for planning handoff.
 * Only findings matching this registry AND passing runtime guards
 * can produce planning requests.
 */
interface PlanningEligibilityRule {
  domain: ValidationDomain | string;
  violationType: string;
  severity: string;
  /** The ChangeSourceKind to use when creating the planning request */
  changeSourceKind: ChangeSourceKind;
  /** Whether section-level scope must be derivable */
  requiresSectionScope: boolean;
}

const PLANNING_ELIGIBILITY_GUARD: PlanningEligibilityRule[] = [
  // required_sections incompleteness with known doc type → planning eligible
  // Validator emits: violationType="incompleteness", severity="warning", scopeLevel="section", affectedSectionKey=<key>
  // Bounded scope: YES — section-level, deterministic via deliverableSectionRegistry
  {
    domain: "required_sections",
    violationType: "incompleteness",
    severity: "warning",
    changeSourceKind: "doc_type_repair",
    requiresSectionScope: false, // section info is in the violation itself
  },
  // required_sections blocking incompleteness → planning eligible
  {
    domain: "required_sections",
    violationType: "incompleteness",
    severity: "blocking",
    changeSourceKind: "doc_type_repair",
    requiresSectionScope: false,
  },
  // NOTE: canon_entity_coverage is NOT planning-eligible.
  // Validator emits violationType="contradiction" (not "incompleteness"),
  // scopeLevel="document", affectedSectionKey=null.
  // No bounded section scope is derivable → routed to issue_eligible instead.
];

function findPlanningRule(violation: Violation): PlanningEligibilityRule | null {
  for (const rule of PLANNING_ELIGIBILITY_GUARD) {
    if (
      rule.domain === violation.domain &&
      rule.violationType === violation.violationType &&
      rule.severity === violation.severity
    ) {
      return rule;
    }
  }
  return null;
}

// ── Planning Request ──

export interface PlanningRequest {
  /** Stable key for dedupe */
  planningKey: string;
  /** Fingerprint (SHA-256 hex) */
  fingerprint: string;
  /** ChangeSource-compatible payload for Impact Engine */
  changeSource: ChangeSource;
  /** The violation that triggered this request */
  sourceViolationKey: string;
  /** Affected section key if derivable */
  affectedSectionKey: string | null;
  /** Summary of what the planning request addresses */
  summary: string;
  /** Whether the downstream planner supports section-level scope */
  sectionScopeSupported: boolean;
}

// ── Handoff Outcome ──

export type PlanningHandoffOutcome =
  | "planning_created"
  | "planning_blocked"
  | "planning_deferred"
  | "planning_duplicate_suppressed";

export interface PlanningFindingResult {
  violationKey: string;
  outcome: PlanningHandoffOutcome;
  planningRequest: PlanningRequest | null;
  reason: string;
}

export interface PlanningHandoffRequest {
  projectId: string;
  lane: string;
  violations: Violation[];
  validationRunId?: string;
  skipTransitions?: boolean;
}

export interface PlanningHandoffResult {
  projectId: string;
  processedAt: string;
  totalViolations: number;
  results: PlanningFindingResult[];
  created: number;
  blocked: number;
  deferred: number;
  duplicatesSuppressed: number;
}

// ── Fingerprint ──

async function computePlanningFingerprint(
  violationKey: string,
  authVersionId: string | null,
  sectionKey: string | null,
): Promise<string> {
  const raw = `planning:${violationKey}:${authVersionId || "none"}:${sectionKey || "none"}`;
  const msgBuffer = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// ── Main Entry Point ──

/**
 * Route planning-eligible validation findings into bounded planning requests.
 *
 * FAIL-CLOSED: Findings that fail authority, lane, or scope guards are blocked.
 * DEDUPE: Uses SHA-256 fingerprint checked against recent Transition Ledger entries.
 * NO EXECUTION: Returns transient planning requests only. Does NOT call computeImpact.
 */
export async function handoffToPlanningQueue(
  supabase: any,
  request: PlanningHandoffRequest,
): Promise<PlanningHandoffResult> {
  const result: PlanningHandoffResult = {
    projectId: request.projectId,
    processedAt: new Date().toISOString(),
    totalViolations: request.violations.length,
    results: [],
    created: 0,
    blocked: 0,
    deferred: 0,
    duplicatesSuppressed: 0,
  };

  // Emit handoff requested
  if (!request.skipTransitions) {
    await emitTransition(supabase, {
      projectId: request.projectId,
      eventType: TRANSITION_EVENTS.VALIDATION_PLANNING_HANDOFF_REQUESTED,
      eventDomain: "validation",
      lane: request.lane,
      status: "intent",
      sourceOfTruth: "validation-planning-handoff-v2",
      resultingState: {
        total_violations: request.violations.length,
        validation_run_id: request.validationRunId || null,
      },
    }, { critical: false });
  }

  const lane = request.lane as LaneKey;
  const ladder = LANE_DOC_LADDERS[lane] || [];
  const ladderSet = new Set(ladder);

  for (const violation of request.violations) {
    const findingResult = await processViolation(
      supabase, request, violation, ladderSet, lane,
    );
    result.results.push(findingResult);
    switch (findingResult.outcome) {
      case "planning_created": result.created++; break;
      case "planning_blocked": result.blocked++; break;
      case "planning_deferred": result.deferred++; break;
      case "planning_duplicate_suppressed": result.duplicatesSuppressed++; break;
    }
  }

  console.log(`[validation-planning-handoff] completed { project: "${request.projectId}", total: ${result.totalViolations}, created: ${result.created}, blocked: ${result.blocked}, deferred: ${result.deferred}, suppressed: ${result.duplicatesSuppressed} }`);

  return result;
}

// ── Per-Violation Processing ──

async function processViolation(
  supabase: any,
  request: PlanningHandoffRequest,
  violation: Violation,
  ladderSet: Set<string>,
  lane: LaneKey,
): Promise<PlanningFindingResult> {

  // ── Guard 1: Planning eligibility rule match ──
  const rule = findPlanningRule(violation);
  if (!rule) {
    return emitAndReturn(supabase, request, violation, "planning_deferred",
      "no_matching_planning_eligibility_rule", null);
  }

  // ── Guard 2: Doc type known ──
  if (!violation.affectedDocType) {
    return emitAndReturn(supabase, request, violation, "planning_blocked",
      "no_affected_doc_type", null);
  }

  // ── Guard 3: Lane validity ──
  if (!ladderSet.has(violation.affectedDocType)) {
    return emitAndReturn(supabase, request, violation, "planning_blocked",
      "doc_type_not_in_lane_ladder", null);
  }

  // ── Guard 4: Authoritative version existence ──
  let authVersionId = violation.authoritativeVersionId;
  if (!authVersionId && violation.affectedDocumentId) {
    // Attempt to resolve current version
    const { data: currentVer } = await supabase
      .from("project_document_versions")
      .select("id")
      .eq("document_id", violation.affectedDocumentId)
      .eq("is_current", true)
      .maybeSingle();
    authVersionId = currentVer?.id || null;
  }

  if (!authVersionId) {
    return emitAndReturn(supabase, request, violation, "planning_blocked",
      "no_authoritative_version", null);
  }

  // ── Guard 5: Authoritative version is current ──
  const { data: verCheck } = await supabase
    .from("project_document_versions")
    .select("id, is_current")
    .eq("id", authVersionId)
    .maybeSingle();

  if (!verCheck || !verCheck.is_current) {
    return emitAndReturn(supabase, request, violation, "planning_blocked",
      "authoritative_version_not_current", null);
  }

  // ── Guard 6: Ambiguity check ──
  if (violation.violationType === "ambiguity") {
    return emitAndReturn(supabase, request, violation, "planning_blocked",
      "ambiguous_finding_not_planning_safe", null);
  }

  // ── Guard 7: Section scope derivation ──
  const sectionKey = violation.affectedSectionKey || null;
  const sectionConfig = getSectionConfig(violation.affectedDocType);
  const sectionScopeSupported = sectionConfig !== null && sectionConfig.sections.length > 0;

  // ── Dedupe: check recent planning transitions for same fingerprint ──
  const fp = await computePlanningFingerprint(
    violation.violationKey, authVersionId, sectionKey,
  );

  const { data: recentDupes } = await supabase
    .from("pipeline_transitions")
    .select("id")
    .eq("project_id", request.projectId)
    .eq("event_type", TRANSITION_EVENTS.VALIDATION_PLANNING_REQUEST_CREATED)
    .filter("resulting_state->>fingerprint", "eq", fp)
    .limit(1);

  if (recentDupes && recentDupes.length > 0) {
    if (!request.skipTransitions) {
      await emitTransition(supabase, {
        projectId: request.projectId,
        eventType: TRANSITION_EVENTS.VALIDATION_PLANNING_DUPLICATE_SUPPRESSED,
        eventDomain: "validation",
        lane: request.lane,
        docType: violation.affectedDocType,
        status: "completed",
        sourceOfTruth: "validation-planning-handoff-v2",
        resultingState: {
          violation_key: violation.violationKey,
          fingerprint: fp,
          existing_transition_id: recentDupes[0].id,
        },
      }, { critical: false });
    }
    return {
      violationKey: violation.violationKey,
      outcome: "planning_duplicate_suppressed",
      planningRequest: null,
      reason: "duplicate_planning_request_exists",
    };
  }

  // ── Build ChangeSource-compatible planning request ──
  const changeSource: ChangeSource = {
    kind: rule.changeSourceKind,
    sourceId: violation.affectedDocumentId || violation.affectedDocType!,
    label: `validation-finding:${violation.domain}:${violation.violationKey.slice(0, 30)}`,
    projectId: request.projectId,
    lane,
    originDocType: violation.affectedDocType!,
    triggerVersionId: authVersionId,
  };

  const planningKey = `planning:${violation.violationKey}:${authVersionId}`;

  const planningRequest: PlanningRequest = {
    planningKey,
    fingerprint: fp,
    changeSource,
    sourceViolationKey: violation.violationKey,
    affectedSectionKey: sectionKey,
    summary: violation.summary,
    sectionScopeSupported,
  };

  // ── Emit planning request created ──
  if (!request.skipTransitions) {
    await emitTransition(supabase, {
      projectId: request.projectId,
      eventType: TRANSITION_EVENTS.VALIDATION_PLANNING_REQUEST_CREATED,
      eventDomain: "validation",
      lane: request.lane,
      docType: violation.affectedDocType,
      resultingVersionId: authVersionId,
      status: "completed",
      sourceOfTruth: "validation-planning-handoff-v2",
      resultingState: {
        planning_key: planningKey,
        fingerprint: fp,
        violation_key: violation.violationKey,
        change_source_kind: changeSource.kind,
        affected_section_key: sectionKey,
        section_scope_supported: sectionScopeSupported,
        domain: violation.domain,
        severity: violation.severity,
      },
    }, { critical: false });
  }

  return {
    violationKey: violation.violationKey,
    outcome: "planning_created",
    planningRequest,
    reason: "planning_request_created",
  };
}

// ── Emit blocked/deferred + return helper ──

async function emitAndReturn(
  supabase: any,
  request: PlanningHandoffRequest,
  violation: Violation,
  outcome: PlanningHandoffOutcome,
  reason: string,
  planningRequest: PlanningRequest | null,
): Promise<PlanningFindingResult> {
  const isBlocked = outcome === "planning_blocked";

  if (!request.skipTransitions) {
    await emitTransition(supabase, {
      projectId: request.projectId,
      eventType: isBlocked
        ? TRANSITION_EVENTS.VALIDATION_PLANNING_HANDOFF_BLOCKED
        : TRANSITION_EVENTS.VALIDATION_PLANNING_HANDOFF_CLASSIFIED,
      eventDomain: "validation",
      lane: request.lane,
      docType: violation.affectedDocType || undefined,
      status: isBlocked ? "failed" : "completed",
      sourceOfTruth: "validation-planning-handoff-v2",
      resultingState: {
        violation_key: violation.violationKey,
        outcome,
        reason,
      },
    }, { critical: false });
  }

  return {
    violationKey: violation.violationKey,
    outcome,
    planningRequest,
    reason,
  };
}
