/**
 * Review Queue Bridge v1
 *
 * Routes manual_only validation findings into the review_tasks table
 * for structured human review. Does NOT trigger repair, planning, or
 * Auto-Run actions.
 *
 * SCOPE:
 *   - Consumes manual_only findings from validation handoff
 *   - Persists as review_tasks with fingerprint-based dedupe
 *   - Emits transition events for audit
 *   - Fail-closed: blocked if DB insert fails
 *
 * ARCHITECTURE:
 *   - Separate from project_issues (no second issue system)
 *   - Read/write to review_tasks only
 *   - No document mutation
 *   - No repair or planning triggers
 */

import type { Violation } from "./narrativeIntegrityValidator.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";

// ── Review Task Outcome ──

export type ReviewTaskOutcome =
  | "review_task_created"
  | "duplicate_suppressed"
  | "blocked";

export interface ReviewTaskResult {
  violationKey: string;
  outcome: ReviewTaskOutcome;
  reviewTaskId: string | null;
  fingerprint: string;
  reason: string;
}

export interface ReviewQueueBridgeRequest {
  projectId: string;
  violations: Violation[];
  lane: string;
  validationRunId?: string;
  skipTransitions?: boolean;
}

export interface ReviewQueueBridgeResult {
  projectId: string;
  processedAt: string;
  totalViolations: number;
  results: ReviewTaskResult[];
  created: number;
  duplicatesSuppressed: number;
  blocked: number;
}

// ── Fingerprint ──

async function computeReviewFingerprint(violationKey: string): Promise<string> {
  const raw = `review:${violationKey}`;
  const msgBuffer = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

// ── Severity Mapping ──

function violationSeverityToNumeric(severity: string): number {
  switch (severity) {
    case "blocking": return 5;
    case "warning": return 3;
    case "informational": return 1;
    default: return 3;
  }
}

// ── Main Entry Point ──

/**
 * Route manual_only validation findings into the review_tasks table.
 *
 * FAIL-CLOSED: If insert fails, emits validation_review_blocked and
 * records the finding as blocked.
 *
 * DEDUPE: Uses SHA-256 fingerprint of "review:" + violationKey.
 * Suppresses duplicate if an active review_task (open/acknowledged)
 * with the same fingerprint exists for the project.
 */
export async function routeToReviewQueue(
  supabase: any,
  request: ReviewQueueBridgeRequest,
): Promise<ReviewQueueBridgeResult> {
  const result: ReviewQueueBridgeResult = {
    projectId: request.projectId,
    processedAt: new Date().toISOString(),
    totalViolations: request.violations.length,
    results: [],
    created: 0,
    duplicatesSuppressed: 0,
    blocked: 0,
  };

  for (const violation of request.violations) {
    const fp = await computeReviewFingerprint(violation.violationKey);

    // ── Dedupe: check for existing active review task ──
    const { data: existing } = await supabase
      .from("review_tasks")
      .select("id, status")
      .eq("project_id", request.projectId)
      .eq("fingerprint", fp)
      .in("status", ["open", "acknowledged"])
      .maybeSingle();

    if (existing) {
      // Update last_seen_run_id
      await supabase
        .from("review_tasks")
        .update({ last_seen_run_id: request.validationRunId || null })
        .eq("id", existing.id);

      if (!request.skipTransitions) {
        await emitTransition(supabase, {
          projectId: request.projectId,
          eventType: TRANSITION_EVENTS.VALIDATION_REVIEW_DUPLICATE_SUPPRESSED,
          eventDomain: "validation",
          lane: request.lane,
          status: "completed",
          sourceOfTruth: "review-queue-bridge-v1",
          resultingState: {
            violation_key: violation.violationKey,
            existing_review_task_id: existing.id,
            fingerprint: fp,
          },
        }, { critical: false });
      }

      result.results.push({
        violationKey: violation.violationKey,
        outcome: "duplicate_suppressed",
        reviewTaskId: existing.id,
        fingerprint: fp,
        reason: "active_review_task_exists",
      });
      result.duplicatesSuppressed++;
      continue;
    }

    // ── Create review task ──
    const { data: newTask, error: insertError } = await supabase
      .from("review_tasks")
      .insert({
        project_id: request.projectId,
        source_type: "validation",
        source_key: violation.violationKey,
        doc_type: violation.affectedDocType || null,
        doc_version_id: violation.authoritativeVersionId || null,
        anchor_section: violation.affectedSectionKey || null,
        review_category: violation.violationType || "ambiguity",
        severity: violationSeverityToNumeric(violation.severity),
        summary: violation.summary,
        detail: violation.details,
        evidence_json: violation.evidenceRefs || {},
        fingerprint: fp,
        status: "open",
        created_from_run_id: request.validationRunId || null,
        last_seen_run_id: request.validationRunId || null,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error(`[review-queue-bridge] insert failed:`, insertError.message);

      if (!request.skipTransitions) {
        await emitTransition(supabase, {
          projectId: request.projectId,
          eventType: TRANSITION_EVENTS.VALIDATION_REVIEW_BLOCKED,
          eventDomain: "validation",
          lane: request.lane,
          status: "failed",
          sourceOfTruth: "review-queue-bridge-v1",
          resultingState: {
            violation_key: violation.violationKey,
            fingerprint: fp,
            error: insertError.message,
          },
        }, { critical: false });
      }

      result.results.push({
        violationKey: violation.violationKey,
        outcome: "blocked",
        reviewTaskId: null,
        fingerprint: fp,
        reason: `insert_failed: ${insertError.message}`,
      });
      result.blocked++;
      continue;
    }

    // ── Emit created event ──
    if (!request.skipTransitions) {
      await emitTransition(supabase, {
        projectId: request.projectId,
        eventType: TRANSITION_EVENTS.VALIDATION_REVIEW_TASK_CREATED,
        eventDomain: "validation",
        lane: request.lane,
        docType: violation.affectedDocType || undefined,
        status: "completed",
        sourceOfTruth: "review-queue-bridge-v1",
        resultingState: {
          review_task_id: newTask.id,
          violation_key: violation.violationKey,
          fingerprint: fp,
          review_category: violation.violationType,
          severity: violationSeverityToNumeric(violation.severity),
        },
      }, { critical: false });
    }

    result.results.push({
      violationKey: violation.violationKey,
      outcome: "review_task_created",
      reviewTaskId: newTask.id,
      fingerprint: fp,
      reason: "created",
    });
    result.created++;
  }

  console.log(`[review-queue-bridge] completed { project: "${request.projectId}", total: ${result.totalViolations}, created: ${result.created}, suppressed: ${result.duplicatesSuppressed}, blocked: ${result.blocked} }`);

  return result;
}
