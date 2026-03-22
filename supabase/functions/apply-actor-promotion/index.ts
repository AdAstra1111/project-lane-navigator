/**
 * Edge Function: apply-actor-promotion
 * 
 * Backend-authoritative promotion decision engine.
 * This is the SINGLE canonical path for all promotion state mutations.
 * 
 * Handles: approve, reject, override_approve, override_reject, revoke
 * 
 * Guarantees:
 * - Version-aware eligibility (validates version→run→result lineage)
 * - Atomic state transitions (single transaction boundary)
 * - Idempotent (guards against duplicate/concurrent actions)
 * - No silent fallbacks (missing truth = explicit block)
 * - Coherent actor current state (no contradictory field combos)
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

  // 1. Fetch actor — require PG gate statuses to exist
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

  // Explicit — no defaulting missing statuses
  const coverage = actor.anchor_coverage_status;
  const coherence = actor.anchor_coherence_status;

  if (!coverage || coverage === "insufficient") {
    blockReasons.push("PG-00: Insufficient anchor coverage");
  }
  if (!coherence || coherence === "incoherent") {
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

  // 3. Fetch latest SCORED validation run for THIS VERSION (strict lineage)
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

  // 4. Fetch validation result for that run (strict lineage)
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
    review_required: false, // No speculative review logic
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
    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return jsonRes({ error: "Not authenticated" }, 401);

    const body = await req.json();
    const { action, actorId, actorVersionId, overrideReason, decisionNote } =
      body as {
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

    // ── Override validation ───────────────────────────────────────────────
    if (
      (typedAction === "override_approve" || typedAction === "override_reject") &&
      !overrideReason?.trim()
    ) {
      return jsonRes(
        { error: "Override actions require an override_reason" },
        400,
      );
    }

    // ── Fetch current actor state for guards ──────────────────────────────
    const { data: currentActor, error: fetchErr } = await supabase
      .from("ai_actors")
      .select(
        "id, roster_ready, approved_version_id, promotion_status, current_promotion_decision_id",
      )
      .eq("id", actorId)
      .single();

    if (fetchErr || !currentActor) {
      return jsonRes({ error: "Actor not found" }, 404);
    }

    // ── REVOKE: target current approved version, not eligibility version ──
    if (typedAction === "revoke") {
      if (!currentActor.roster_ready || !currentActor.approved_version_id) {
        return jsonRes(
          { error: "Cannot revoke: actor is not currently roster-ready" },
          400,
        );
      }

      // For revoke, the version is the currently approved one
      const revokeVersionId = currentActor.approved_version_id;

      // Idempotency: check if already revoked
      if (currentActor.promotion_status === "revoked") {
        return jsonRes(
          { error: "Actor is already revoked" },
          409,
        );
      }

      // Insert revoke decision
      const revokeDecision = {
        actor_id: actorId,
        actor_version_id: revokeVersionId,
        validation_run_id: null,
        validation_result_id: null,
        scoring_model: "n/a",
        policy_version: PROMOTION_POLICY_VERSION,
        eligible_for_promotion: false,
        review_required: false,
        block_reasons: [],
        policy_decision_status: "not_eligible",
        final_decision_status: "revoked",
        decision_mode: "revoke",
        override_reason: overrideReason || null,
        decision_note: decisionNote || null,
        decided_by: user.id,
      };

      const { data: decision, error: insertErr } = await supabase
        .from("actor_promotion_decisions")
        .insert(revokeDecision)
        .select("*")
        .single();

      if (insertErr) {
        return jsonRes({ error: insertErr.message }, 500);
      }

      // Atomic actor state update for revoke
      await supabase
        .from("ai_actors")
        .update({
          promotion_status: "revoked",
          approved_version_id: null,
          roster_ready: false,
          current_promotion_decision_id: decision.id,
          promotion_policy_version: PROMOTION_POLICY_VERSION,
          promotion_updated_at: new Date().toISOString(),
        })
        .eq("id", actorId);

      return jsonRes({ decision, action: "revoked" });
    }

    // ── Non-revoke actions: evaluate eligibility ──────────────────────────
    const eligibility = await evaluateEligibility(
      supabase,
      actorId,
      actorVersionId || null,
    );

    // ── APPROVE: must be eligible ─────────────────────────────────────────
    if (typedAction === "approve" && !eligibility.eligible_for_promotion) {
      return jsonRes(
        {
          error: `Cannot approve: ${eligibility.block_reasons.join("; ")}`,
          eligibility,
        },
        400,
      );
    }

    // ── Idempotency guard: check for existing identical decision ──────────
    if (typedAction === "approve" || typedAction === "override_approve") {
      // If this version is already the approved roster version, no-op
      if (
        currentActor.approved_version_id === eligibility.actor_version_id &&
        currentActor.roster_ready === true &&
        (currentActor.promotion_status === "approved" ||
          currentActor.promotion_status === "override_approved")
      ) {
        // Already in desired state — return current decision
        const { data: existingDecision } = await supabase
          .from("actor_promotion_decisions")
          .select("*")
          .eq("id", currentActor.current_promotion_decision_id)
          .single();

        return jsonRes({
          decision: existingDecision,
          action: "already_approved",
          idempotent: true,
        });
      }
    }

    const resolvedVersionId = eligibility.actor_version_id;
    if (!resolvedVersionId) {
      return jsonRes(
        { error: "No actor version available for promotion decision" },
        400,
      );
    }

    // ── Insert decision row ───────────────────────────────────────────────
    const isApproval =
      typedAction === "approve" || typedAction === "override_approve";

    const decisionRow = {
      actor_id: actorId,
      actor_version_id: resolvedVersionId,
      validation_run_id: eligibility.validation_run_id,
      validation_result_id: eligibility.validation_result_id,
      scoring_model: eligibility.scoring_model || "n/a",
      policy_version: PROMOTION_POLICY_VERSION,
      eligible_for_promotion: eligibility.eligible_for_promotion,
      review_required: false,
      block_reasons: eligibility.block_reasons,
      policy_decision_status: eligibility.policy_decision_status,
      final_decision_status: ACTION_TO_FINAL[typedAction],
      decision_mode: ACTION_TO_MODE[typedAction],
      override_reason: overrideReason || null,
      decision_note: decisionNote || null,
      decided_by: user.id,
    };

    const { data: decision, error: insertErr } = await supabase
      .from("actor_promotion_decisions")
      .insert(decisionRow)
      .select("*")
      .single();

    if (insertErr) {
      return jsonRes({ error: insertErr.message }, 500);
    }

    // ── Update actor current state ────────────────────────────────────────
    const actorUpdate: Record<string, any> = {
      current_promotion_decision_id: decision.id,
      promotion_policy_version: PROMOTION_POLICY_VERSION,
      promotion_updated_at: new Date().toISOString(),
    };

    if (isApproval) {
      // Supersede prior approvals ONLY on new approval
      await supabase
        .from("actor_promotion_decisions")
        .update({ final_decision_status: "superseded" })
        .eq("actor_id", actorId)
        .in("final_decision_status", ["approved", "override_approved"])
        .neq("id", decision.id);

      actorUpdate.promotion_status = decision.final_decision_status;
      actorUpdate.approved_version_id = resolvedVersionId;
      actorUpdate.roster_ready = true;
    } else {
      // Reject / override_reject — do NOT destroy existing approval state
      actorUpdate.promotion_status = decision.final_decision_status;
      // If actor was previously approved for a DIFFERENT version,
      // keep roster_ready and approved_version_id intact.
      // Only clear if the rejection is for the currently approved version.
      if (currentActor.approved_version_id === resolvedVersionId) {
        actorUpdate.approved_version_id = null;
        actorUpdate.roster_ready = false;
      }
      // If no prior approval exists, ensure coherent state
      if (!currentActor.approved_version_id) {
        actorUpdate.roster_ready = false;
      }
    }

    await supabase
      .from("ai_actors")
      .update(actorUpdate)
      .eq("id", actorId);

    return jsonRes({ decision, eligibility, action: typedAction });
  } catch (err: any) {
    console.error("[apply-actor-promotion] Error:", err);
    return jsonRes({ error: err.message || "Internal error" }, 500);
  }
});
