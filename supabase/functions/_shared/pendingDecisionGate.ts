/**
 * Pending Decisions Gate — Auto-Run integration layer.
 *
 * Uses decision_ledger with status='workflow_pending' for workflow decisions.
 * Canon decisions use status='active' and are never touched here.
 * No separate table — zero schema drift.
 *
 * Workflow decision keys are namespaced: `workflow:<format>:<doc_type>:<semantic_key>`
 * Canon decision keys use: `<format>:<doc_type>:<semantic_key>`
 *
 * narrativeContextResolver only injects status='active', so workflow_pending
 * rows are never injected into prompts.
 */
import {
  getRequiredDecisions,
  classifyDecision,
  buildPendingDecisionKey,
  DECISION_DEFS,
  isQualityPlateau,
  type ClassificationContext,
} from "./decisionPolicyRegistry.ts";

export interface PendingDecisionGateResult {
  shouldPause: boolean;
  blockingIds: string[];
  deferrableIds: string[];
  pauseReason: string | null;
  logSummary: string;
}

/** Build workflow-namespaced key (never collides with canon keys) */
function workflowKey(format: string, docType: string, semanticKey: string): string {
  return `workflow:${format}:${docType}:${semanticKey}`;
}

/**
 * Run the pre-stage decision gate.
 *
 * 1. Load REQUIRED_DECISIONS_BY_STAGE for (format, doc_type)
 * 2. For each required decision_key not already resolved as canon:
 *    - Classify via registry
 *    - Upsert into decision_ledger with status='workflow_pending'
 * 3. Return whether to pause (BLOCKING_NOW) or continue (DEFERRABLE only)
 */
export async function runPendingDecisionGate(
  supabase: any,
  projectId: string,
  jobId: string,
  format: string,
  docType: string,
  ladder: string[],
  allowDefaults: boolean,
): Promise<PendingDecisionGateResult> {
  const required = getRequiredDecisions(format, docType);
  const allRequired = [
    ...required.blocking.map(k => ({ key: k, hint: "blocking" as const })),
    ...required.deferrable.map(k => ({ key: k, hint: "deferrable" as const })),
  ];

  if (allRequired.length === 0) {
    return { shouldPause: false, blockingIds: [], deferrableIds: [], pauseReason: null, logSummary: "No decisions required for this stage" };
  }

  const approvals = await buildApprovalsState(supabase, projectId, ladder);
  const canonState = await buildCanonState(supabase, projectId);

  const ctx: ClassificationContext = {
    format,
    lane: null,
    doc_type: docType,
    stage_index: ladder.indexOf(docType),
    ladder,
    allow_defaults: allowDefaults,
    approvals_state: approvals,
    canon_state: canonState,
  };

  // Check which decisions are already resolved as canon (status='active')
  const resolvedCanonKeys = await getResolvedCanonKeys(supabase, projectId);

  // Check existing workflow_pending decisions
  const { data: existingWorkflow } = await supabase
    .from("decision_ledger")
    .select("id, decision_key, decision_value, status")
    .eq("project_id", projectId)
    .eq("status", "workflow_pending");
  const workflowMap = new Map((existingWorkflow || []).map((d: any) => [d.decision_key, d]));

  const blockingIds: string[] = [];
  const deferrableIds: string[] = [];
  let forcedDeferrableCount = 0;

  for (const { key: semanticKey, hint } of allRequired) {
    const canonKey = buildPendingDecisionKey(format, docType, semanticKey);

    // Already resolved as canon → skip
    if (resolvedCanonKeys.has(canonKey) || resolvedCanonKeys.has(semanticKey)) continue;

    const wfKey = workflowKey(format, docType, semanticKey);

    // Already has workflow_pending row → check classification with hint authority
    const existing = workflowMap.get(wfKey);
    if (existing) {
      const rawCls = existing.decision_value?.classification;
      // Registry authority: deferrable hint overrides BLOCKING_NOW
      const effectiveCls = (hint === "deferrable" && rawCls === "BLOCKING_NOW") ? "DEFERRABLE" : rawCls;
      if (hint === "deferrable" && rawCls === "BLOCKING_NOW") forcedDeferrableCount++;
      if (effectiveCls === "BLOCKING_NOW") blockingIds.push(existing.id);
      else if (effectiveCls === "DEFERRABLE") deferrableIds.push(existing.id);
      continue;
    }

    // Classify deterministically
    const result = classifyDecision(semanticKey, ctx);
    const def = DECISION_DEFS[semanticKey];

    // Registry authority: deferrable hint overrides BLOCKING_NOW from classifier
    const effectiveClassification = (hint === "deferrable" && result.classification === "BLOCKING_NOW")
      ? "DEFERRABLE" : result.classification;
    if (hint === "deferrable" && result.classification === "BLOCKING_NOW") {
      forcedDeferrableCount++;
      console.log(`[decision-gate] Registry override: ${semanticKey} classified BLOCKING_NOW but hint=deferrable → forced DEFERRABLE`);
    }

    // Insert workflow_pending row into decision_ledger
    const { data: inserted } = await supabase.from("decision_ledger").insert({
      project_id: projectId,
      decision_key: wfKey,
      title: def?.question || `Decision required: ${semanticKey}`,
      decision_text: result.reason + (effectiveClassification !== result.classification ? " (Deferrable-by-registry)" : ""),
      decision_value: {
        question: def?.question || `Decision required: ${semanticKey}`,
        options: def?.options || null,
        recommendation: null,
        classification: effectiveClassification,
        raw_classification: result.classification,
        registry_hint: hint,
        required_evidence: def?.required_evidence_template || [],
        revisit_stage: result.revisit_stage,
        scope_json: { format, doc_type: docType },
        provenance: { job_id: jobId, generator: "decision_policy_registry" },
      },
      scope: "project",
      source: "workflow_decision",
      status: "workflow_pending",
    }).select("id, decision_value").single();

    if (inserted) {
      if (effectiveClassification === "BLOCKING_NOW") blockingIds.push(inserted.id);
      else deferrableIds.push(inserted.id);
    }
  }

  const shouldPause = blockingIds.length > 0 && !allowDefaults;
  const pauseReason = shouldPause
    ? `pending_decisions: ${blockingIds.length} blocking decision(s) for ${docType}`
    : null;

  const logSummary = `[decision-gate] format=${format} doc=${docType} blocking=${blockingIds.length} deferrable=${deferrableIds.length} forced_deferrable=${forcedDeferrableCount} pause=${shouldPause}`;
  console.log(logSummary);

  return { shouldPause, blockingIds, deferrableIds, pauseReason, logSummary };
}

/**
 * Quality Plateau Guard — creates a DEFERRABLE workflow decision when scores stagnate.
 */
export async function checkQualityPlateau(
  supabase: any,
  projectId: string,
  jobId: string,
  format: string,
  docType: string,
  ci: number,
  gp: number,
  previousCi: number,
  previousGp: number,
  consecutiveHighScoreAttempts: number,
): Promise<{ isPlateaued: boolean; decisionId?: string }> {
  if (!isQualityPlateau({ ci, gp, previousCi, previousGp, consecutiveHighScoreAttempts })) {
    return { isPlateaued: false };
  }

  const wfKey = workflowKey(format, docType, "QUALITY_PLATEAU");
  const def = DECISION_DEFS["QUALITY_PLATEAU"];

  const { data: inserted } = await supabase.from("decision_ledger").insert({
    project_id: projectId,
    decision_key: wfKey,
    title: def.question,
    decision_text: "Scores stagnating; further rewrites unlikely to yield significant improvement",
    decision_value: {
      question: def.question,
      options: def.options,
      recommendation: { value: "proceed", reason: "Scores stagnating" },
      classification: "DEFERRABLE",
      required_evidence: [],
      revisit_stage: null,
      scope_json: { format, doc_type: docType, ci, gp },
      provenance: { job_id: jobId, generator: "quality_plateau_guard" },
    },
    scope: "project",
    source: "workflow_decision",
    status: "workflow_pending",
  }).select("id").single();

  console.log(`[decision-gate] QUALITY_PLATEAU workflow_pending created for ${format}:${docType} CI=${ci} GP=${gp}`);
  return { isPlateaued: true, decisionId: inserted?.id };
}

/**
 * Resolve a workflow_pending decision: mark superseded + create canon entry.
 * Called from server-side (edge function / auto-run approve-decision handler).
 */
export async function resolvePendingDecision(
  supabase: any,
  decisionId: string,
  resolvedValue: any,
  userId: string,
  options?: { createCanonEntry?: boolean; canonTitle?: string; canonText?: string },
): Promise<void> {
  // Fetch the workflow_pending row
  const { data: decision } = await supabase
    .from("decision_ledger")
    .select("*")
    .eq("id", decisionId)
    .eq("status", "workflow_pending")
    .single();

  if (!decision) throw new Error(`Workflow decision ${decisionId} not found or not workflow_pending`);

  // Mark workflow row as superseded (no longer pending)
  await supabase
    .from("decision_ledger")
    .update({ status: "superseded" })
    .eq("id", decisionId);

  // Create canon entry if requested
  if (options?.createCanonEntry !== false) {
    // Derive canon key from workflow key: strip 'workflow:' prefix
    const canonKey = decision.decision_key.replace(/^workflow:/, "");

    // Supersede any existing active canon decision with same key
    await supabase.from("decision_ledger")
      .update({ status: "superseded" })
      .eq("project_id", decision.project_id)
      .eq("decision_key", canonKey)
      .eq("status", "active");

    await supabase.from("decision_ledger").insert({
      project_id: decision.project_id,
      decision_key: canonKey,
      title: options?.canonTitle || decision.title,
      decision_text: options?.canonText || `Resolved: ${JSON.stringify(resolvedValue)}`,
      decision_value: resolvedValue,
      scope: "project",
      source: "pending_decision_resolved",
      created_by: userId,
      status: "active",
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function buildApprovalsState(
  supabase: any,
  projectId: string,
  ladder: string[],
): Promise<Record<string, { exists: boolean; approved: boolean }>> {
  const result: Record<string, { exists: boolean; approved: boolean }> = {};

  const { data: docs } = await supabase
    .from("project_documents")
    .select("doc_type, latest_version_id")
    .eq("project_id", projectId);

  const docMap = new Map((docs || []).map((d: any) => [d.doc_type, d]));

  const versionIds = (docs || [])
    .filter((d: any) => d.latest_version_id)
    .map((d: any) => d.latest_version_id);

  let approvedSet = new Set<string>();
  if (versionIds.length > 0) {
    const { data: versions } = await supabase
      .from("project_document_versions")
      .select("id, document_id, approval_status")
      .in("id", versionIds.slice(0, 50));
    approvedSet = new Set(
      (versions || [])
        .filter((v: any) => v.approval_status === "approved")
        .map((v: any) => v.id)
    );
  }

  for (const docType of ladder) {
    const doc = docMap.get(docType);
    result[docType] = {
      exists: !!doc,
      approved: doc?.latest_version_id ? approvedSet.has(doc.latest_version_id) : false,
    };
  }

  return result;
}

async function buildCanonState(
  supabase: any,
  projectId: string,
): Promise<{ has_characters: boolean; has_world_rules: boolean }> {
  const { data: facts } = await supabase
    .from("canon_facts")
    .select("fact_type")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .limit(100);

  const types = new Set((facts || []).map((f: any) => f.fact_type));
  return {
    has_characters: types.has("character") || types.has("character_trait"),
    has_world_rules: types.has("world_rule") || types.has("setting"),
  };
}

async function getResolvedCanonKeys(
  supabase: any,
  projectId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("decision_ledger")
    .select("decision_key")
    .eq("project_id", projectId)
    .eq("status", "active");
  return new Set((data || []).map((d: any) => d.decision_key));
}
