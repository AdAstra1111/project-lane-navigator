/**
 * Pending Decisions Gate — Auto-Run integration layer.
 *
 * Checks project_pending_decisions for blocking/deferrable decisions
 * before entering a new stage. Creates decision rows deterministically
 * using the policy registry.
 *
 * DOES NOT touch decision_ledger (canon). That happens only on resolution.
 */
import {
  getRequiredDecisions,
  classifyDecision,
  buildPendingDecisionKey,
  DECISION_DEFS,
  isQualityPlateau,
  type ClassificationContext,
  type DecisionClassification,
} from "./decisionPolicyRegistry.ts";

export interface PendingDecisionGateResult {
  /** True if job should pause (has BLOCKING_NOW decisions) */
  shouldPause: boolean;
  /** IDs of blocking decisions in project_pending_decisions */
  blockingIds: string[];
  /** IDs of deferrable decisions (created but non-blocking) */
  deferrableIds: string[];
  /** Human-readable reason for pause */
  pauseReason: string | null;
  /** Log summary */
  logSummary: string;
}

/**
 * Run the pre-stage decision gate.
 *
 * 1. Load REQUIRED_DECISIONS_BY_STAGE for (format, doc_type)
 * 2. For each required decision_key not already resolved:
 *    - Classify via registry
 *    - Upsert into project_pending_decisions
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

  // Build approvals state from existing documents
  const approvals = await buildApprovalsState(supabase, projectId, ladder);

  // Check canon state
  const canonState = await buildCanonState(supabase, projectId);

  const ctx: ClassificationContext = {
    format,
    lane: null, // will be set from project if available
    doc_type: docType,
    stage_index: ladder.indexOf(docType),
    ladder,
    allow_defaults: allowDefaults,
    approvals_state: approvals,
    canon_state: canonState,
  };

  // Check which decisions are already resolved in decision_ledger (canon)
  const resolvedKeys = await getResolvedDecisionKeys(supabase, projectId);

  // Check existing pending decisions
  const { data: existingPending } = await supabase
    .from("project_pending_decisions")
    .select("id, decision_key, classification, status")
    .eq("project_id", projectId)
    .in("status", ["pending"]);
  const pendingMap = new Map((existingPending || []).map((d: any) => [d.decision_key, d]));

  const blockingIds: string[] = [];
  const deferrableIds: string[] = [];

  for (const { key: semanticKey } of allRequired) {
    const fullKey = buildPendingDecisionKey(format, docType, semanticKey);

    // Already resolved in canon → skip
    if (resolvedKeys.has(semanticKey) || resolvedKeys.has(fullKey)) continue;

    // Already pending → check classification
    const existing = pendingMap.get(fullKey);
    if (existing) {
      if (existing.classification === "BLOCKING_NOW") blockingIds.push(existing.id);
      else if (existing.classification === "DEFERRABLE") deferrableIds.push(existing.id);
      continue;
    }

    // Classify deterministically
    const result = classifyDecision(semanticKey, ctx);
    const def = DECISION_DEFS[semanticKey];

    // Upsert into project_pending_decisions
    const { data: inserted } = await supabase.from("project_pending_decisions").upsert({
      project_id: projectId,
      decision_key: fullKey,
      question: def?.question || `Decision required: ${semanticKey}`,
      options: def?.options || null,
      recommendation: null,
      classification: result.classification,
      required_evidence: def?.required_evidence_template || [],
      revisit_stage: result.revisit_stage,
      scope_json: { format, doc_type: docType },
      source: { job_id: jobId, generator: "decision_policy_registry" },
      status: "pending",
    }, {
      onConflict: "project_id,decision_key",
      ignoreDuplicates: false,
    }).select("id, classification").single();

    if (inserted) {
      if (inserted.classification === "BLOCKING_NOW") blockingIds.push(inserted.id);
      else if (inserted.classification === "DEFERRABLE") deferrableIds.push(inserted.id);
    }
  }

  const shouldPause = blockingIds.length > 0 && !allowDefaults;
  const pauseReason = shouldPause
    ? `pending_decisions: ${blockingIds.length} blocking decision(s) for ${docType}`
    : null;

  const logSummary = `[decision-gate] format=${format} doc=${docType} blocking=${blockingIds.length} deferrable=${deferrableIds.length} pause=${shouldPause}`;
  console.log(logSummary);

  return { shouldPause, blockingIds, deferrableIds, pauseReason, logSummary };
}

/**
 * Quality Plateau Guard — creates a DEFERRABLE decision when scores stagnate.
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

  const fullKey = buildPendingDecisionKey(format, docType, "QUALITY_PLATEAU");
  const def = DECISION_DEFS["QUALITY_PLATEAU"];

  const { data: inserted } = await supabase.from("project_pending_decisions").upsert({
    project_id: projectId,
    decision_key: fullKey,
    question: def.question,
    options: def.options,
    recommendation: { value: "proceed", reason: "Scores stagnating; further rewrites unlikely to yield significant improvement" },
    classification: "DEFERRABLE",
    required_evidence: [],
    revisit_stage: null,
    scope_json: { format, doc_type: docType, ci, gp },
    source: { job_id: jobId, generator: "quality_plateau_guard" },
    status: "pending",
  }, {
    onConflict: "project_id,decision_key",
    ignoreDuplicates: false,
  }).select("id").single();

  console.log(`[decision-gate] QUALITY_PLATEAU created for ${format}:${docType} CI=${ci} GP=${gp}`);
  return { isPlateaued: true, decisionId: inserted?.id };
}

/**
 * Resolve a pending decision: mark resolved + optionally create canon entry.
 */
export async function resolvePendingDecision(
  supabase: any,
  decisionId: string,
  resolvedValue: any,
  userId: string,
  options?: { createCanonEntry?: boolean; canonTitle?: string; canonText?: string },
): Promise<void> {
  // Update pending decision
  const { data: decision } = await supabase
    .from("project_pending_decisions")
    .update({ status: "resolved", updated_at: new Date().toISOString() })
    .eq("id", decisionId)
    .select("*")
    .single();

  if (!decision) throw new Error(`Decision ${decisionId} not found`);

  // Optionally create canon entry in decision_ledger
  if (options?.createCanonEntry !== false) {
    const semanticKey = decision.decision_key.split(":").pop() || decision.decision_key;
    
    // Supersede any existing active canon decision with same key
    await supabase.from("decision_ledger")
      .update({ status: "superseded" })
      .eq("project_id", decision.project_id)
      .eq("decision_key", decision.decision_key)
      .eq("status", "active");

    await supabase.from("decision_ledger").insert({
      project_id: decision.project_id,
      decision_key: decision.decision_key,
      title: options?.canonTitle || decision.question,
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

  // Check approval status of current versions
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

async function getResolvedDecisionKeys(
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
