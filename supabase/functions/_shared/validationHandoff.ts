/**
 * Validation-to-Issue / Validation-to-Planning Handoff v1
 *
 * Transforms structured narrative integrity validation findings into
 * safe downstream artifacts (issues) without creating uncontrolled
 * repair loops or a second orchestration engine.
 *
 * SCOPE (v1):
 *   - Issue handoff: eligible violations → project_issues rows (via fingerprint dedup)
 *   - Planning handoff: DEFERRED (not safe without execution integration validation)
 *   - Duplicate suppression: violations with matching fingerprint + active issue are skipped
 *   - Transition events: handoff-path events emitted for audit
 *
 * ARCHITECTURE:
 *   - Reuses existing project_issues table (fingerprint-based dedup)
 *   - Reuses existing project_issue_events table (audit trail)
 *   - Does NOT create a new issue system
 *   - Does NOT trigger automatic repair or rewrite
 *   - Fail-closed: blocked/unsupported findings never create issues
 *   - Deterministic: eligibility is classified by a static registry, not AI inference
 *
 * HANDOFF ELIGIBILITY CLASSIFICATIONS:
 *   - issue_eligible: finding can be safely converted to a project_issues row
 *   - planning_eligible: finding could inform a repair plan (DEFERRED in v1)
 *   - manual_only: finding requires human review before any action
 *   - informational_only: finding is advisory and should not create an issue
 *   - blocked: finding is invalid or unsupported for handoff
 */

import type { Violation, ViolationType, ViolationSeverity, ValidationDomain } from "./narrativeIntegrityValidator.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";
import { routeToReviewQueue } from "./reviewQueueBridge.ts";
import { handoffToPlanningQueue, type PlanningHandoffResult } from "./validationPlanningHandoff.ts";

// ── Handoff Eligibility Classification ──

export type HandoffEligibility =
  | "issue_eligible"
  | "planning_eligible"
  | "manual_only"
  | "informational_only"
  | "blocked";

/**
 * Handoff Eligibility Registry — deterministic classification.
 *
 * Maps (violationType, severity, domain) → eligibility.
 * This is the SOLE authority for what can be handed off.
 */
interface EligibilityRule {
  violationType: ViolationType | "*";
  severity: ViolationSeverity | "*";
  domain: string | "*";
  eligibility: HandoffEligibility;
  reason: string;
}

const ELIGIBILITY_RULES: EligibilityRule[] = [
  // Unsupported domains are never handed off
  { violationType: "unsupported_domain", severity: "*", domain: "*", eligibility: "blocked", reason: "unsupported_validation_domain" },

  // Consistency passes are informational only
  { violationType: "consistency_pass", severity: "*", domain: "*", eligibility: "informational_only", reason: "clean_validation_pass" },

  // Blocking contradictions → issue eligible
  { violationType: "contradiction", severity: "blocking", domain: "*", eligibility: "issue_eligible", reason: "blocking_contradiction" },

  // Warning contradictions → issue eligible (non-blocking issue)
  { violationType: "contradiction", severity: "warning", domain: "*", eligibility: "issue_eligible", reason: "warning_contradiction" },

  // Informational contradictions → informational only
  { violationType: "contradiction", severity: "informational", domain: "*", eligibility: "informational_only", reason: "informational_contradiction" },

  // Blocking incompleteness → issue eligible
  { violationType: "incompleteness", severity: "blocking", domain: "*", eligibility: "issue_eligible", reason: "blocking_incompleteness" },

  // Warning incompleteness on planning-supported domains → planning eligible
  // ONLY required_sections is planning-eligible: it emits violationType="incompleteness" with section-level scope
  // canon_entity_coverage is NOT planning-eligible: it emits violationType="contradiction" with document-level scope (no bounded section target)
  { violationType: "incompleteness", severity: "warning", domain: "required_sections", eligibility: "planning_eligible", reason: "plannable_missing_sections" },

  // Warning incompleteness (other domains) → issue eligible
  { violationType: "incompleteness", severity: "warning", domain: "*", eligibility: "issue_eligible", reason: "warning_incompleteness" },

  // Informational incompleteness → informational only
  { violationType: "incompleteness", severity: "informational", domain: "*", eligibility: "informational_only", reason: "informational_incompleteness" },

  // Ambiguity → manual only (never auto-create issues for ambiguous findings)
  { violationType: "ambiguity", severity: "*", domain: "*", eligibility: "manual_only", reason: "ambiguous_finding_requires_review" },
];

/**
 * Classify a violation's handoff eligibility.
 * Rules are evaluated in order; first match wins.
 */
export function classifyHandoffEligibility(violation: Violation): { eligibility: HandoffEligibility; reason: string } {
  for (const rule of ELIGIBILITY_RULES) {
    const typeMatch = rule.violationType === "*" || rule.violationType === violation.violationType;
    const sevMatch = rule.severity === "*" || rule.severity === violation.severity;
    const domainMatch = rule.domain === "*" || rule.domain === violation.domain;
    if (typeMatch && sevMatch && domainMatch) {
      return { eligibility: rule.eligibility, reason: rule.reason };
    }
  }
  // Default: blocked (fail-closed)
  return { eligibility: "blocked", reason: "no_matching_eligibility_rule" };
}

// ── Fingerprint for Dedupe ──

/**
 * Compute a stable fingerprint for a validation violation suitable for
 * dedup against project_issues.fingerprint.
 *
 * Uses the violation's violationKey (already stable from the validator)
 * hashed to 40 hex chars via SHA-256 to match the existing fingerprint format.
 */
async function computeViolationFingerprint(violation: Violation): Promise<string> {
  const raw = `validation:${violation.violationKey}`;
  const msgBuffer = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// ── Severity Mapping ──

function violationSeverityToNumeric(severity: ViolationSeverity): number {
  switch (severity) {
    case "blocking": return 5;
    case "warning": return 3;
    case "informational": return 1;
    default: return 3;
  }
}

function violationTypeToCategory(violation: Violation): string {
  // Map to existing project_issues categories
  switch (violation.domain) {
    case "authority_binding": return "structural";
    case "lane_doc_type": return "structural";
    case "locked_decision_presence": return "continuity";
    case "canon_entity_coverage": return "continuity";
    case "required_sections": return "structural";
    case "unit_mention_staleness": return "continuity";
    default: return "structural";
  }
}

// ── Handoff Request / Result ──

export interface HandoffRequest {
  projectId: string;
  violations: Violation[];
  lane: string;
  /** Source validation run ID for provenance */
  validationRunId?: string;
  /** If true, skip transition event emission (for testing) */
  skipTransitions?: boolean;
}

export interface HandoffFindingResult {
  violationKey: string;
  eligibility: HandoffEligibility;
  reason: string;
  outcome: "issue_created" | "duplicate_suppressed" | "blocked" | "informational_skipped" | "manual_only_skipped" | "planning_deferred" | "planning_created" | "planning_blocked" | "planning_duplicate_suppressed" | "review_task_created" | "review_task_duplicate_suppressed" | "review_task_blocked";
  issueId: string | null;
  reviewTaskId?: string | null;
  planningRequestKey?: string | null;
}

export interface HandoffResult {
  projectId: string;
  handoffAt: string;
  totalViolations: number;
  findings: HandoffFindingResult[];
  issuesCreated: number;
  duplicatesSuppressed: number;
  blocked: number;
  informationalSkipped: number;
  manualOnlySkipped: number;
  planningDeferred: number;
  planningCreated: number;
  planningBlocked: number;
  planningDuplicatesSuppressed: number;
}

// ── Main Handoff Entry Point ──

/**
 * Hand off validation findings to downstream systems.
 *
 * v1: Issue creation only. Planning handoff is explicitly deferred.
 *
 * FAIL-CLOSED:
 *   - Ambiguous findings → manual_only (no issue created)
 *   - Unsupported domains → blocked (no issue created)
 *   - Duplicate active issues → suppressed (no duplicate created)
 *
 * DOES NOT:
 *   - Trigger repair or rewrite
 *   - Create planning requests (deferred)
 *   - Modify existing issues
 *   - Run validation (consumes already-computed violations)
 */
export async function handoffValidationFindings(
  supabase: any,
  request: HandoffRequest,
): Promise<HandoffResult> {
  const result: HandoffResult = {
    projectId: request.projectId,
    handoffAt: new Date().toISOString(),
    totalViolations: request.violations.length,
    findings: [],
    issuesCreated: 0,
    duplicatesSuppressed: 0,
    blocked: 0,
    informationalSkipped: 0,
    manualOnlySkipped: 0,
    planningDeferred: 0,
    planningCreated: 0,
    planningBlocked: 0,
    planningDuplicatesSuppressed: 0,
  };

  // ── Emit handoff requested event ──
  if (!request.skipTransitions) {
    await emitTransition(supabase, {
      projectId: request.projectId,
      eventType: TRANSITION_EVENTS.VALIDATION_HANDOFF_REQUESTED,
      eventDomain: "validation",
      lane: request.lane,
      status: "intent",
      sourceOfTruth: "validation-handoff-v1",
      resultingState: {
        total_violations: request.violations.length,
        validation_run_id: request.validationRunId || null,
      },
    }, { critical: false });
  }

  // ── Process each violation ──
  const manualOnlyViolations: Violation[] = [];
  const planningEligibleViolations: Violation[] = [];
  const issueEvents: Array<{ issue_id: string; event_type: string; payload?: unknown }> = [];

  for (const violation of request.violations) {
    const { eligibility, reason } = classifyHandoffEligibility(violation);

    // ── Classification transition ──
    if (!request.skipTransitions) {
      await emitTransition(supabase, {
        projectId: request.projectId,
        eventType: TRANSITION_EVENTS.VALIDATION_HANDOFF_CLASSIFIED,
        eventDomain: "validation",
        lane: request.lane,
        docType: violation.affectedDocType || undefined,
        status: "completed",
        sourceOfTruth: "validation-handoff-v1",
        resultingState: {
          violation_key: violation.violationKey,
          eligibility,
          reason,
          violation_type: violation.violationType,
          severity: violation.severity,
          domain: violation.domain,
        },
      }, { critical: false });
    }

    // ── Route by eligibility ──
    switch (eligibility) {
      case "issue_eligible": {
        const findingResult = await handleIssueEligible(
          supabase, request, violation, issueEvents,
        );
        result.findings.push(findingResult);
        if (findingResult.outcome === "issue_created") result.issuesCreated++;
        if (findingResult.outcome === "duplicate_suppressed") result.duplicatesSuppressed++;
        break;
      }

      case "planning_eligible": {
        // v2: Route to planning handoff bridge
        planningEligibleViolations.push(violation);
        break;
      }

      case "manual_only": {
        // Route to review queue bridge
        manualOnlyViolations.push(violation);
        break;
      }

      case "informational_only": {
        result.findings.push({
          violationKey: violation.violationKey,
          eligibility,
          reason,
          outcome: "informational_skipped",
          issueId: null,
        });
        result.informationalSkipped++;
        break;
      }

      case "blocked": {
        if (!request.skipTransitions) {
          await emitTransition(supabase, {
            projectId: request.projectId,
            eventType: TRANSITION_EVENTS.VALIDATION_HANDOFF_BLOCKED,
            eventDomain: "validation",
            lane: request.lane,
            status: "completed",
            sourceOfTruth: "validation-handoff-v1",
            resultingState: {
              violation_key: violation.violationKey,
              reason,
            },
          }, { critical: false });
        }
        result.findings.push({
          violationKey: violation.violationKey,
          eligibility,
          reason,
          outcome: "blocked",
          issueId: null,
        });
        result.blocked++;
        break;
      }
    }
  }

  // ── Batch-insert issue events ──
  if (issueEvents.length > 0) {
    await supabase.from("project_issue_events").insert(issueEvents);
  }

  // ── Route manual_only violations to review queue ──
  if (manualOnlyViolations.length > 0) {
    const reviewResult = await routeToReviewQueue(supabase, {
      projectId: request.projectId,
      violations: manualOnlyViolations,
      lane: request.lane,
      validationRunId: request.validationRunId,
      skipTransitions: request.skipTransitions,
    });

    for (const r of reviewResult.results) {
      const outcomeMap: Record<string, HandoffFindingResult["outcome"]> = {
        review_task_created: "review_task_created",
        duplicate_suppressed: "review_task_duplicate_suppressed",
        blocked: "review_task_blocked",
      };
      result.findings.push({
        violationKey: r.violationKey,
        eligibility: "manual_only",
        reason: r.reason,
        outcome: outcomeMap[r.outcome] || "review_task_blocked",
        issueId: null,
        reviewTaskId: r.reviewTaskId,
      });
    }
    result.manualOnlySkipped = reviewResult.created + reviewResult.duplicatesSuppressed + reviewResult.blocked;
  }

  // ── Route planning_eligible violations to planning handoff bridge ──
  if (planningEligibleViolations.length > 0) {
    const planningResult = await handoffToPlanningQueue(supabase, {
      projectId: request.projectId,
      lane: request.lane,
      violations: planningEligibleViolations,
      validationRunId: request.validationRunId,
      skipTransitions: request.skipTransitions,
    });

    for (const r of planningResult.results) {
      const outcomeMap: Record<string, HandoffFindingResult["outcome"]> = {
        planning_created: "planning_created",
        planning_blocked: "planning_blocked",
        planning_deferred: "planning_deferred",
        planning_duplicate_suppressed: "planning_duplicate_suppressed",
      };
      result.findings.push({
        violationKey: r.violationKey,
        eligibility: "planning_eligible",
        reason: r.reason,
        outcome: outcomeMap[r.outcome] || "planning_blocked",
        issueId: null,
        planningRequestKey: r.planningRequest?.planningKey || null,
      });
    }
    result.planningCreated = planningResult.created;
    result.planningBlocked = planningResult.blocked;
    result.planningDeferred = planningResult.deferred;
    result.planningDuplicatesSuppressed = planningResult.duplicatesSuppressed;
  }

  console.log(`[validation-handoff] completed { project: "${request.projectId}", violations: ${result.totalViolations}, issues_created: ${result.issuesCreated}, duplicates_suppressed: ${result.duplicatesSuppressed}, blocked: ${result.blocked}, informational: ${result.informationalSkipped}, manual_only: ${result.manualOnlySkipped}, planning_created: ${result.planningCreated}, planning_blocked: ${result.planningBlocked}, planning_deferred: ${result.planningDeferred} }`);

  return result;
}

// ── Issue-Eligible Handler ──

async function handleIssueEligible(
  supabase: any,
  request: HandoffRequest,
  violation: Violation,
  issueEvents: Array<{ issue_id: string; event_type: string; payload?: unknown }>,
): Promise<HandoffFindingResult> {
  const fp = await computeViolationFingerprint(violation);

  // ── Dedupe: check for existing active issue with same fingerprint ──
  const { data: existing } = await supabase
    .from("project_issues")
    .select("id, status")
    .eq("project_id", request.projectId)
    .eq("fingerprint", fp)
    .maybeSingle();

  if (existing) {
    // Active issue exists — suppress duplicate
    if (!request.skipTransitions) {
      await emitTransition(supabase, {
        projectId: request.projectId,
        eventType: TRANSITION_EVENTS.VALIDATION_HANDOFF_DUPLICATE_SUPPRESSED,
        eventDomain: "validation",
        lane: request.lane,
        status: "completed",
        sourceOfTruth: "validation-handoff-v1",
        resultingState: {
          violation_key: violation.violationKey,
          existing_issue_id: existing.id,
          existing_status: existing.status,
          fingerprint: fp,
        },
      }, { critical: false });
    }

    return {
      violationKey: violation.violationKey,
      eligibility: "issue_eligible",
      reason: "duplicate_active_issue",
      outcome: "duplicate_suppressed",
      issueId: existing.id,
    };
  }

  // ── Create new issue ──
  const docType = violation.affectedDocType || "unknown";
  const category = violationTypeToCategory(violation);
  const severity = violationSeverityToNumeric(violation.severity);

  const { data: newIssue, error: insertError } = await supabase
    .from("project_issues")
    .insert({
      project_id: request.projectId,
      doc_type: docType,
      doc_version_id: violation.authoritativeVersionId || null,
      anchor: violation.affectedSectionKey || null,
      category,
      severity,
      status: "open",
      summary: violation.summary,
      detail: violation.details,
      evidence_snippet: JSON.stringify(violation.evidenceRefs).slice(0, 500) || null,
      fingerprint: fp,
      created_from_run_id: request.validationRunId || null,
      last_seen_run_id: request.validationRunId || null,
      resolution_mode: "staged",
    })
    .select("id")
    .single();

  if (insertError) {
    console.error(`[validation-handoff] issue insert failed:`, insertError.message);
    return {
      violationKey: violation.violationKey,
      eligibility: "issue_eligible",
      reason: `insert_failed: ${insertError.message}`,
      outcome: "blocked",
      issueId: null,
    };
  }

  // ── Record issue event ──
  issueEvents.push({
    issue_id: newIssue.id,
    event_type: "created",
    payload: {
      source: "validation_handoff",
      violation_key: violation.violationKey,
      violation_type: violation.violationType,
      domain: violation.domain,
      validation_run_id: request.validationRunId || null,
    },
  });

  // ── Emit issue-created transition ──
  if (!request.skipTransitions) {
    await emitTransition(supabase, {
      projectId: request.projectId,
      eventType: TRANSITION_EVENTS.VALIDATION_ISSUE_CREATED,
      eventDomain: "validation",
      lane: request.lane,
      docType,
      status: "completed",
      sourceOfTruth: "validation-handoff-v1",
      resultingState: {
        issue_id: newIssue.id,
        violation_key: violation.violationKey,
        fingerprint: fp,
        category,
        severity,
      },
    }, { critical: false });
  }

  return {
    violationKey: violation.violationKey,
    eligibility: "issue_eligible",
    reason: "issue_created",
    outcome: "issue_created",
    issueId: newIssue.id,
  };
}
