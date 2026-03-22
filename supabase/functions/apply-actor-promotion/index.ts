/**
 * Edge Function: apply-actor-promotion
 * 
 * Backend-authoritative promotion decision engine.
 * SINGLE canonical path for all promotion state mutations.
 * 
 * All writes are delegated to the apply_promotion_decision RPC
 * which executes atomically within a single Postgres transaction.
 * 
 * Handles: approve, reject, override_approve, override_reject, revoke
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonRes(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PROMOTION_POLICY_VERSION = "phase4-corrective-v2";

type PromotionAction = "approve" | "reject" | "override_approve" | "override_reject" | "revoke";

const ACTION_TO_MODE: Record<PromotionAction, string> = {
  approve: "manual_approve",
  reject: "manual_reject",
  override_approve: "override_approve",
  override_reject: "override_reject",
  revoke: "revoke",
};

const ACTION_TO_FINAL: Record<PromotionAction, string> = {
  approve: "approved",
  reject: "rejected",
  override_approve: "override_approved",
  override_reject: "override_rejected",
  revoke: "revoked",
};

interface EligibilityResult {
  actor_id: string;
  actor_version_id: string | null;
  validation_run_id: string | null;
  validation_result_id: string | null;
  scoring_model: string | null;
  policy_version: string;
  eligible_for_promotion: boolean;
  review_required: boolean;
  block_reasons: string[];
  policy_decision_status: string;
}

/**
 * Evaluate promotion eligibility for a SPECIFIC actor version.
 * Strict version-aware lineage: version → run → result.
 * No silent fallbacks.
 */
async function evaluateEligibility(
  supabase: any,
  actorId: string,
  actorVersionId: string | null,
): Promise<EligibilityResult> {
  const blockReasons: string[] = [];

  // 1. Fetch actor PG gate statuses — no silent fallbacks
  const { data: actor, error: actorErr } = await supabase
    .from("ai_actors")
    .select("anchor_coverage_status, anchor_coherence_status")
    .eq("id", actorId)
    .single();

  if (actorErr || !actor) {
    return {
      actor_id: actorId,
      actor_version_id: actorVersionId,
      validation_run_id: null,
      validation_result_id: null,
      scoring_model: null,
      policy_version: PROMOTION_POLICY_VERSION,
      eligible_for_promotion: false,
      review_required: false,
      block_reasons: ["actor_not_found"],
      policy_decision_status: "not_eligible",
    };
  }

  if (!actor.anchor_coverage_status || actor.anchor_coverage_status === "insufficient") {
    blockReasons.push("PG-00: Insufficient anchor coverage");
  }
  if (!actor.anchor_coherence_status || actor.anchor_coherence_status === "incoherent") {
    blockReasons.push("PG-01: Anchor set incoherent");
  }

  // 2. Resolve version if not provided
  if (!actorVersionId) {
    const { data: versions } = await supabase
      .from("ai_actor_versions")
      .select("id")
      .eq("actor_id", actorId)
      .order("version_number", { ascending: false })
      .limit(1);
    actorVersionId = versions?.[0]?.id || null;
  }

  if (!actorVersionId) {
    blockReasons.push("actor_version_not_found");
    return {
      actor_id: actorId,
      actor_version_id: null,
      validation_run_id: null,
      validation_result_id: null,
      scoring_model: null,
      policy_version: PROMOTION_POLICY_VERSION,
      eligible_for_promotion: false,
      review_required: false,
      block_reasons: blockReasons,
      policy_decision_status: "not_eligible",
    };
  }

  // 3. Validate version belongs to actor
  const { data: versionCheck } = await supabase
    .from("ai_actor_versions")
    .select("id")
    .eq("id", actorVersionId)
    .eq("actor_id", actorId)
    .single();

  if (!versionCheck) {
    blockReasons.push("version_actor_mismatch: Version does not belong to this actor");
    return {
      actor_id: actorId,
      actor_version_id: actorVersionId,
      validation_run_id: null,
      validation_result_id: null,
      scoring_model: null,
      policy_version: PROMOTION_POLICY_VERSION,
      eligible_for_promotion: false,
      review_required: false,
      block_reasons: blockReasons,
      policy_decision_status: "not_eligible",
    };
  }

  // 4. Fetch latest SCORED validation run for THIS VERSION (strict lineage)
  const { data: runs } = await supabase
    .from("actor_validation_runs")
    .select("id, status, actor_version_id")
    .eq("actor_id", actorId)
    .eq("actor_version_id", actorVersionId)
    .eq("status", "scored")
    .order("created_at", { ascending: false })
    .limit(1);

  const scoredRun = runs?.[0];
  if (!scoredRun) {
    blockReasons.push("validation_run_missing: No scored validation run for this version");
  }

  // 5. Fetch validation result for that run
  let validationResult: any = null;
  if (scoredRun) {
    const { data: result } = await supabase
      .from("actor_validation_results")
      .select("id, promotable, hard_fail_codes, failure_reasons, scoring_model, overall_score")
      .eq("validation_run_id", scoredRun.id)
      .single();
    validationResult = result;
  }

  if (scoredRun && !validationResult) {
    blockReasons.push("validation_result_missing: Scored run exists but no result found");
  }

  if (validationResult && !validationResult.promotable) {
    blockReasons.push(
      `Validation result not promotable (score: ${validationResult.overall_score})`,
    );
    if (validationResult.hard_fail_codes?.length > 0) {
      blockReasons.push(`Hard fails: ${validationResult.hard_fail_codes.join(", ")}`);
    }
    if (validationResult.failure_reasons?.length > 0) {
      for (const r of validationResult.failure_reasons) {
        blockReasons.push(r);
      }
    }
  }

  const eligible = blockReasons.length === 0;

  return {
    actor_id: actorId,
    actor_version_id: actorVersionId,
    validation_run_id: scoredRun?.id || null,
    validation_result_id: validationResult?.id || null,
    scoring_model: validationResult?.scoring_model || null,
    policy_version: PROMOTION_POLICY_VERSION,
    eligible_for_promotion: eligible,
    review_required: false,
    block_reasons: blockReasons,
    policy_decision_status: eligible ? "eligible" : "not_eligible",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify caller
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return jsonRes({ error: "Not authenticated" }, 401);

    const body = await req.json();
    const { action, actorId, actorVersionId, overrideReason, decisionNote } = body as {
      action: string;
      actorId: string;
      actorVersionId?: string;
      overrideReason?: string;
      decisionNote?: string;
    };

    if (!action || !actorId) {
      return jsonRes({ error: "action and actorId are required" }, 400);
    }

    const validActions: PromotionAction[] = [
      "approve", "reject", "override_approve", "override_reject", "revoke",
    ];
    if (!validActions.includes(action as PromotionAction)) {
      return jsonRes({ error: `Invalid action: ${action}` }, 400);
    }

    const typedAction = action as PromotionAction;

    // Override validation
    if (
      (typedAction === "override_approve" || typedAction === "override_reject") &&
      !overrideReason?.trim()
    ) {
      return jsonRes({ error: "Override actions require an override_reason" }, 400);
    }

    // ── REVOKE: target current approved version ──────────────────────────
    if (typedAction === "revoke") {
      const { data: currentActor } = await supabase
        .from("ai_actors")
        .select("approved_version_id, roster_ready, promotion_status")
        .eq("id", actorId)
        .single();

      if (!currentActor?.roster_ready || !currentActor?.approved_version_id) {
        return jsonRes({ error: "Cannot revoke: actor is not currently roster-ready" }, 400);
      }

      // Call atomic RPC — revoke has no validation lineage (null is intentional, not "n/a")
      const { data: rpcResult, error: rpcErr } = await supabase.rpc("apply_promotion_decision", {
        p_actor_id: actorId,
        p_actor_version_id: currentActor.approved_version_id,
        p_validation_run_id: null,
        p_validation_result_id: null,
        p_scoring_model: null,
        p_policy_version: PROMOTION_POLICY_VERSION,
        p_eligible_for_promotion: false,
        p_review_required: false,
        p_block_reasons: [],
        p_policy_decision_status: "not_eligible",
        p_final_decision_status: "revoked",
        p_decision_mode: "revoke",
        p_override_reason: overrideReason || null,
        p_decision_note: decisionNote || null,
        p_decided_by: user.id,
      });

      if (rpcErr) return jsonRes({ error: rpcErr.message }, 500);

      // Fetch the persisted decision for response
      const { data: decision } = await supabase
        .from("actor_promotion_decisions")
        .select("*")
        .eq("id", rpcResult.decision_id)
        .single();

      return jsonRes({ decision, action: "revoked", idempotent: rpcResult.idempotent });
    }

    // ── Non-revoke: evaluate eligibility ─────────────────────────────────
    const eligibility = await evaluateEligibility(supabase, actorId, actorVersionId || null);

    // APPROVE must be eligible
    if (typedAction === "approve" && !eligibility.eligible_for_promotion) {
      return jsonRes({
        error: `Cannot approve: ${eligibility.block_reasons.join("; ")}`,
        eligibility,
      }, 400);
    }

    const resolvedVersionId = eligibility.actor_version_id;
    if (!resolvedVersionId) {
      return jsonRes({ error: "No actor version available for promotion decision" }, 400);
    }

    // Call atomic RPC
    const { data: rpcResult, error: rpcErr } = await supabase.rpc("apply_promotion_decision", {
      p_actor_id: actorId,
      p_actor_version_id: resolvedVersionId,
      p_validation_run_id: eligibility.validation_run_id,
      p_validation_result_id: eligibility.validation_result_id,
      p_scoring_model: eligibility.scoring_model,
      p_policy_version: PROMOTION_POLICY_VERSION,
      p_eligible_for_promotion: eligibility.eligible_for_promotion,
      p_review_required: false,
      p_block_reasons: eligibility.block_reasons,
      p_policy_decision_status: eligibility.policy_decision_status,
      p_final_decision_status: ACTION_TO_FINAL[typedAction],
      p_decision_mode: ACTION_TO_MODE[typedAction],
      p_override_reason: overrideReason || null,
      p_decision_note: decisionNote || null,
      p_decided_by: user.id,
    });

    if (rpcErr) return jsonRes({ error: rpcErr.message }, 500);

    if (rpcResult.idempotent) {
      const { data: existingDecision } = await supabase
        .from("actor_promotion_decisions")
        .select("*")
        .eq("id", rpcResult.decision_id)
        .single();
      return jsonRes({ decision: existingDecision, eligibility, action: typedAction, idempotent: true });
    }

    // Fetch the newly created decision
    const { data: decision } = await supabase
      .from("actor_promotion_decisions")
      .select("*")
      .eq("id", rpcResult.decision_id)
      .single();

    return jsonRes({ decision, eligibility, action: typedAction });
  } catch (err: any) {
    console.error("[apply-actor-promotion] Error:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500);
  }
});
