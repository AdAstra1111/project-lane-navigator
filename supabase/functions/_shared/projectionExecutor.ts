/**
 * Projection Executor — Document Projection Layer v1
 *
 * Executes bounded repair plans produced by the Impact Resolver against
 * existing rewrite infrastructure. This is NOT a second rewrite engine.
 * It is a thin, validated adapter that:
 *
 *   1. Validates the repair plan is still eligible (freshness, authority, lane)
 *   2. Translates plan scope into inputs for existing section repair / rewrite paths
 *   3. Routes execution through doc-os.createVersion (canonical version creation)
 *   4. Emits Transition Ledger events for execution outcomes
 *   5. Blocks ambiguous, stale, or invalid plans from executing
 *
 * SCOPE (v1):
 *   - Analysis + Planning + Execution for supported doc types
 *   - Manual/invoked execution only — no automatic propagation loops
 *   - Section-targeted execution via sectionRepairEngine where supported
 *   - Document-level fallback blocked unless explicitly allowed by caller
 *   - Episodic block execution deferred (planning-only for now)
 *
 * TRUTH HIERARCHY (enforced):
 *   Canon > Locked Decisions > Canon Units > Authoritative Documents > Corpus > AI Inference
 *
 * FAIL-CLOSED:
 *   Stale plans, missing authoritative versions, lane-invalid targets,
 *   ambiguous scope, and unsupported doc types all block execution.
 *
 * ARCHITECTURE:
 *   - Reuses sectionRepairEngine for section extraction/replacement
 *   - Reuses doc-os.createVersion for version persistence
 *   - Does NOT call LLMs directly — caller must provide rewritten content
 *   - Does NOT create a second orchestration model
 *   - Does NOT auto-wire into Auto-Run (manual invocation only in v1)
 */

import {
  type BoundedRepairPlan,
  type ScopePrecision,
  validateRepairEligibility,
} from "./impactEngine.ts";
import {
  replaceSection,
  type SectionReplaceResult,
} from "./sectionRepairEngine.ts";
import { createVersion, type CreateVersionOpts } from "./doc-os.ts";
import { emitTransition, TRANSITION_EVENTS } from "./transitionLedger.ts";

// ── Doc-Type Execution Support Matrix ──

/**
 * Explicit classification of which doc types support projection execution.
 *
 * execution_supported: section repair engine handles this doc type
 * planning_only: impact resolver can plan but execution is not yet safe
 * blocked: no support at all
 */
export type ExecutionSupportLevel = "execution_supported" | "planning_only" | "blocked";

const EXECUTION_SUPPORT_MATRIX: Record<string, ExecutionSupportLevel> = {
  // Section-repair-supported doc types (from deliverableSectionRegistry)
  concept_brief: "execution_supported",
  format_rules: "execution_supported",
  character_bible: "execution_supported",
  season_arc: "execution_supported",
  treatment: "execution_supported",
  long_treatment: "execution_supported",
  story_outline: "execution_supported",
  beat_sheet: "execution_supported",

  // Episodic doc types — planning-only until episodic executor is integrated
  episode_grid: "planning_only",
  vertical_episode_beats: "planning_only",
  episode_beats: "planning_only",

  // Scripts — planning-only (scene-level repair exists but needs separate integration)
  feature_script: "planning_only",
  season_script: "planning_only",
  episode_script: "planning_only",

  // Other development docs — not yet supported
  market_sheet: "planning_only",
  vertical_market_sheet: "planning_only",
  creative_brief: "planning_only",
};

export function getExecutionSupport(docType: string): ExecutionSupportLevel {
  return EXECUTION_SUPPORT_MATRIX[docType] || "blocked";
}

/**
 * Return the full support matrix for validation/audit purposes.
 */
export function getExecutionSupportMatrix(): Record<string, ExecutionSupportLevel> {
  return { ...EXECUTION_SUPPORT_MATRIX };
}

// ── Execution Request ──

export interface ProjectionExecutionRequest {
  /** The bounded repair plan to execute */
  plan: BoundedRepairPlan;
  /** The rewritten content for the affected sections.
   *  Keys are section_key values matching plan.affectedSections.
   *  For full_document scope: use key "__full_document". */
  rewrittenContent: Record<string, string>;
  /** User or system ID executing the projection */
  executedBy: string;
  /** Generator ID for version provenance */
  generatorId: string;
  /** Inputs used for provenance tracking */
  inputsUsed: Record<string, any>;
  /** Project format for lane-aware resolution */
  format?: string | null;
  /** If true, allow full_document scope (normally blocked in v1) */
  allowFullDocumentScope?: boolean;
}

// ── Execution Result ──

export type ExecutionOutcome = "completed" | "blocked" | "failed";

export interface ProjectionExecutionResult {
  outcome: ExecutionOutcome;
  /** New version ID if execution succeeded */
  newVersionId: string | null;
  /** New version number if execution succeeded */
  newVersionNumber: number | null;
  /** Block or failure reasons */
  reasons: string[];
  /** Scope that was actually applied */
  appliedScope: {
    mode: "section_targeted" | "full_document" | "none";
    sectionKeys: string[];
    precision: ScopePrecision;
  };
  /** Authoritative version that was bound at execution time */
  boundAuthoritativeVersionId: string | null;
  /** Whether authoritative version was rebound (changed since plan) */
  wasRebound: boolean;
}

// ── Main Execution Entry Point ──

/**
 * Execute a bounded repair plan through existing rewrite infrastructure.
 *
 * FAIL-CLOSED: Returns blocked result for any validation failure.
 * Does NOT silently widen scope beyond what the plan allows.
 * Does NOT call LLMs — expects rewritten content as input.
 *
 * @param supabase - Supabase client (service-role)
 * @param request - Execution request with plan and rewritten content
 * @returns Execution result with outcome, version info, and audit data
 */
export async function executeRepairPlan(
  supabase: any,
  request: ProjectionExecutionRequest,
): Promise<ProjectionExecutionResult> {
  const { plan } = request;
  const projectId = plan.changeSource.projectId;

  const blockedResult = (reasons: string[]): ProjectionExecutionResult => ({
    outcome: "blocked",
    newVersionId: null,
    newVersionNumber: null,
    reasons,
    appliedScope: { mode: "none", sectionKeys: [], precision: "blocked" },
    boundAuthoritativeVersionId: plan.authoritativeVersionId,
    wasRebound: false,
  });

  try {
    // ── PHASE 1: Doc-type execution support check ──
    const supportLevel = getExecutionSupport(plan.targetDocType);
    if (supportLevel !== "execution_supported") {
      const reason = `doc_type_not_execution_supported:${plan.targetDocType}:level=${supportLevel}`;
      await emitBlockedTransition(supabase, projectId, plan, [reason]);
      return blockedResult([reason]);
    }

    // ── PHASE 2: Plan-level validation (from impact engine) ──
    const planError = await validateRepairEligibility(supabase, plan);
    if (planError) {
      await emitBlockedTransition(supabase, projectId, plan, [planError]);
      return blockedResult([planError]);
    }

    // ── PHASE 3: Authoritative version freshness guard ──
    const freshness = await validateAuthoritativeVersionFreshness(supabase, plan);
    if (freshness.blocked) {
      await emitBlockedTransition(supabase, projectId, plan, freshness.reasons);
      return blockedResult(freshness.reasons);
    }
    const boundVersionId = freshness.currentAuthoritativeVersionId!;
    const wasRebound = boundVersionId !== plan.authoritativeVersionId;

    // ── PHASE 4: Scope validation ──
    const scopeValidation = validateScope(request);
    if (scopeValidation.blocked) {
      await emitBlockedTransition(supabase, projectId, plan, scopeValidation.reasons);
      return blockedResult(scopeValidation.reasons);
    }

    // ── Emit validated transition ──
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.PROJECTION_EXECUTION_VALIDATED,
      eventDomain: "projection",
      docType: plan.targetDocType,
      lane: plan.changeSource.lane,
      resultingVersionId: boundVersionId,
      trigger: plan.changeSource.kind,
      sourceOfTruth: "projection-executor-v1",
      status: "completed",
      resultingState: {
        scope_mode: plan.scopeMode,
        scope_precision: plan.scopePrecision,
        was_rebound: wasRebound,
        section_count: plan.affectedSections.length,
      },
    }, { critical: false });

    // ── PHASE 5: Fetch authoritative version content ──
    const { data: authVersion } = await supabase
      .from("project_document_versions")
      .select("plaintext, version_number, document_id")
      .eq("id", boundVersionId)
      .maybeSingle();

    if (!authVersion?.plaintext) {
      const reason = "authoritative_version_has_no_plaintext";
      await emitBlockedTransition(supabase, projectId, plan, [reason]);
      return blockedResult([reason]);
    }

    // ── Emit started transition ──
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.PROJECTION_EXECUTION_STARTED,
      eventDomain: "projection",
      docType: plan.targetDocType,
      lane: plan.changeSource.lane,
      sourceVersionId: boundVersionId,
      trigger: plan.changeSource.kind,
      sourceOfTruth: "projection-executor-v1",
      status: "intent",
      resultingState: {
        scope_mode: plan.scopeMode,
        section_keys: plan.affectedSections.map(s => s.sectionKey),
      },
    }, { critical: false });

    // ── PHASE 6: Apply scope and produce new content ──
    let newContent: string;
    let appliedSectionKeys: string[] = [];

    if (plan.scopeMode === "section_targeted") {
      // Section-targeted execution via sectionRepairEngine
      const sectionResult = applySectionRepairs(
        authVersion.plaintext,
        plan.targetDocType,
        plan.affectedSections.map(s => s.sectionKey),
        request.rewrittenContent,
      );

      if (!sectionResult.success) {
        const reason = `section_repair_failed:${sectionResult.reason}`;
        await emitFailedTransition(supabase, projectId, plan, boundVersionId, [reason]);
        return {
          outcome: "failed",
          newVersionId: null,
          newVersionNumber: null,
          reasons: [reason],
          appliedScope: {
            mode: "section_targeted",
            sectionKeys: sectionResult.appliedKeys,
            precision: plan.scopePrecision,
          },
          boundAuthoritativeVersionId: boundVersionId,
          wasRebound,
        };
      }

      newContent = sectionResult.content;
      appliedSectionKeys = sectionResult.appliedKeys;
    } else if (plan.scopeMode === "full_document" && request.allowFullDocumentScope) {
      // Full-document scope (only when explicitly allowed)
      const fullContent = request.rewrittenContent["__full_document"];
      if (!fullContent) {
        const reason = "full_document_content_missing:key=__full_document";
        await emitFailedTransition(supabase, projectId, plan, boundVersionId, [reason]);
        return {
          outcome: "failed",
          newVersionId: null,
          newVersionNumber: null,
          reasons: [reason],
          appliedScope: { mode: "full_document", sectionKeys: [], precision: plan.scopePrecision },
          boundAuthoritativeVersionId: boundVersionId,
          wasRebound,
        };
      }
      newContent = fullContent;
    } else {
      // Blocked scope (includes full_document without explicit allow)
      const reason = plan.scopeMode === "full_document"
        ? "full_document_scope_not_allowed_in_v1"
        : `unsupported_scope_mode:${plan.scopeMode}`;
      await emitBlockedTransition(supabase, projectId, plan, [reason]);
      return blockedResult([reason]);
    }

    // ── PHASE 7: Create new version through canonical path ──
    const changeSource = plan.changeSource;
    const newVersion = await createVersion(supabase, {
      documentId: authVersion.document_id,
      docType: plan.targetDocType,
      plaintext: newContent,
      label: `projection_repair:${changeSource.kind}:${changeSource.sourceId}`,
      createdBy: request.executedBy,
      approvalStatus: "draft",
      metaJson: {
        projection_source: changeSource.kind,
        projection_source_id: changeSource.sourceId,
        scope_mode: plan.scopeMode,
        scope_precision: plan.scopePrecision,
        applied_sections: appliedSectionKeys,
        was_rebound: wasRebound,
        bound_authoritative_version: boundVersionId,
      },
      generatorId: request.generatorId,
      inputsUsed: request.inputsUsed,
      parentVersionId: boundVersionId,
      format: request.format,
    });

    // ── Emit completed transition ──
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.PROJECTION_EXECUTION_COMPLETED,
      eventDomain: "projection",
      docType: plan.targetDocType,
      lane: changeSource.lane,
      sourceVersionId: boundVersionId,
      resultingVersionId: newVersion.id,
      trigger: changeSource.kind,
      sourceOfTruth: "projection-executor-v1",
      status: "completed",
      resultingState: {
        new_version_number: newVersion.version_number,
        scope_mode: plan.scopeMode,
        scope_precision: plan.scopePrecision,
        applied_sections: appliedSectionKeys,
        was_rebound: wasRebound,
        content_length: newContent.length,
      },
    }, { critical: false });

    console.log(`[projection-executor] completed { doc_type: "${plan.targetDocType}", new_version: ${newVersion.version_number}, scope: "${plan.scopeMode}", precision: "${plan.scopePrecision}", sections: [${appliedSectionKeys.join(",")}] }`);

    return {
      outcome: "completed",
      newVersionId: newVersion.id,
      newVersionNumber: newVersion.version_number,
      reasons: [],
      appliedScope: {
        mode: plan.scopeMode === "full_document" ? "full_document" : "section_targeted",
        sectionKeys: appliedSectionKeys,
        precision: plan.scopePrecision,
      },
      boundAuthoritativeVersionId: boundVersionId,
      wasRebound,
    };

  } catch (err: any) {
    console.error(`[projection-executor] execution error:`, err?.message);
    await emitFailedTransition(
      supabase, projectId, plan, plan.authoritativeVersionId, [err?.message || "unknown_error"],
    );
    return {
      outcome: "failed",
      newVersionId: null,
      newVersionNumber: null,
      reasons: [err?.message || "unknown_error"],
      appliedScope: { mode: "none", sectionKeys: [], precision: "blocked" },
      boundAuthoritativeVersionId: plan.authoritativeVersionId,
      wasRebound: false,
    };
  }
}

// ── Authoritative Version Freshness Guard ──

interface FreshnessResult {
  blocked: boolean;
  reasons: string[];
  currentAuthoritativeVersionId: string | null;
}

/**
 * Validate that the plan's authoritative version is still current.
 *
 * POLICY: Stale plans HARD FAIL (no rebind).
 * Rationale: Rebinding silently could mask important changes that
 * occurred after the plan was computed. The caller should recompute
 * the impact analysis with the current authoritative version.
 */
async function validateAuthoritativeVersionFreshness(
  supabase: any,
  plan: BoundedRepairPlan,
): Promise<FreshnessResult> {
  if (!plan.authoritativeVersionId) {
    return { blocked: true, reasons: ["no_authoritative_version_in_plan"], currentAuthoritativeVersionId: null };
  }

  const { data: version } = await supabase
    .from("project_document_versions")
    .select("id, is_current, approval_status")
    .eq("id", plan.authoritativeVersionId)
    .maybeSingle();

  if (!version) {
    return {
      blocked: true,
      reasons: [`authoritative_version_deleted:${plan.authoritativeVersionId}`],
      currentAuthoritativeVersionId: null,
    };
  }

  if (!version.is_current) {
    return {
      blocked: true,
      reasons: [
        `authoritative_version_no_longer_current:${plan.authoritativeVersionId}`,
        "stale_plan_hard_fail:recompute_impact_analysis_required",
      ],
      currentAuthoritativeVersionId: null,
    };
  }

  return { blocked: false, reasons: [], currentAuthoritativeVersionId: version.id };
}

// ── Scope Validation ──

interface ScopeValidation {
  blocked: boolean;
  reasons: string[];
}

/**
 * Validate that the execution request matches the plan's allowed scope.
 * Prevents silent scope widening.
 */
function validateScope(request: ProjectionExecutionRequest): ScopeValidation {
  const { plan, rewrittenContent, allowFullDocumentScope } = request;
  const reasons: string[] = [];

  if (plan.scopeMode === "blocked") {
    reasons.push("plan_scope_is_blocked");
    return { blocked: true, reasons };
  }

  if (plan.scopeMode === "full_document" && !allowFullDocumentScope) {
    reasons.push("full_document_scope_requires_explicit_allow");
    return { blocked: true, reasons };
  }

  if (plan.scopeMode === "section_targeted") {
    const planKeys = new Set(plan.affectedSections.map(s => s.sectionKey));
    const providedKeys = new Set(Object.keys(rewrittenContent));

    // Check for scope widening: content provided for sections NOT in the plan
    for (const key of providedKeys) {
      if (!planKeys.has(key)) {
        reasons.push(`scope_widening_rejected:key=${key}_not_in_plan`);
      }
    }

    // Check that at least one planned section has content
    const validKeys = [...planKeys].filter(k => providedKeys.has(k));
    if (validKeys.length === 0) {
      reasons.push("no_rewritten_content_matches_plan_sections");
    }
  }

  if (plan.scopeMode === "full_document") {
    if (!rewrittenContent["__full_document"]) {
      reasons.push("full_document_content_key_missing");
    }
  }

  return { blocked: reasons.length > 0, reasons };
}

// ── Section Repair Adapter ──

interface SectionRepairResult {
  success: boolean;
  content: string;
  appliedKeys: string[];
  reason: string;
}

/**
 * Apply section-level repairs using the existing sectionRepairEngine.
 * Does NOT silently widen to full-document if a section replacement fails.
 * Instead, returns failure so the caller can decide.
 */
function applySectionRepairs(
  originalContent: string,
  docType: string,
  plannedSectionKeys: string[],
  rewrittenContent: Record<string, string>,
): SectionRepairResult {
  let currentContent = originalContent;
  const appliedKeys: string[] = [];
  const failedKeys: string[] = [];

  for (const sectionKey of plannedSectionKeys) {
    const newSectionContent = rewrittenContent[sectionKey];
    if (!newSectionContent) {
      // No content provided for this section — skip (partial execution is OK)
      continue;
    }

    const result: SectionReplaceResult = replaceSection(
      currentContent, docType, sectionKey, newSectionContent,
    );

    if (result.success) {
      currentContent = result.new_content;
      appliedKeys.push(sectionKey);
    } else {
      failedKeys.push(sectionKey);
      console.warn(`[projection-executor] section replace failed: ${sectionKey} — ${result.reason}`);
    }
  }

  if (appliedKeys.length === 0) {
    return {
      success: false,
      content: originalContent,
      appliedKeys: [],
      reason: `all_section_replacements_failed:keys=[${failedKeys.join(",")}]`,
    };
  }

  return {
    success: true,
    content: currentContent,
    appliedKeys,
    reason: failedKeys.length > 0
      ? `partial:applied=[${appliedKeys.join(",")}],failed=[${failedKeys.join(",")}]`
      : `all_applied:[${appliedKeys.join(",")}]`,
  };
}

// ── Transition Emission Helpers ──

async function emitBlockedTransition(
  supabase: any,
  projectId: string,
  plan: BoundedRepairPlan,
  reasons: string[],
): Promise<void> {
  try {
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.PROJECTION_EXECUTION_BLOCKED,
      eventDomain: "projection",
      docType: plan.targetDocType,
      lane: plan.changeSource.lane,
      resultingVersionId: plan.authoritativeVersionId || undefined,
      trigger: plan.changeSource.kind,
      sourceOfTruth: "projection-executor-v1",
      status: "failed",
      resultingState: {
        block_reasons: reasons,
        scope_mode: plan.scopeMode,
        scope_precision: plan.scopePrecision,
      },
    }, { critical: false });
  } catch (e: any) {
    console.warn(`[projection-executor] blocked transition emit failed: ${e?.message}`);
  }
}

async function emitFailedTransition(
  supabase: any,
  projectId: string,
  plan: BoundedRepairPlan,
  sourceVersionId: string | null,
  reasons: string[],
): Promise<void> {
  try {
    await emitTransition(supabase, {
      projectId,
      eventType: TRANSITION_EVENTS.PROJECTION_EXECUTION_FAILED,
      eventDomain: "projection",
      docType: plan.targetDocType,
      lane: plan.changeSource.lane,
      sourceVersionId: sourceVersionId || undefined,
      trigger: plan.changeSource.kind,
      sourceOfTruth: "projection-executor-v1",
      status: "failed",
      resultingState: {
        failure_reasons: reasons,
        scope_mode: plan.scopeMode,
      },
    }, { critical: false });
  } catch (e: any) {
    console.warn(`[projection-executor] failed transition emit failed: ${e?.message}`);
  }
}
