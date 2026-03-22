/**
 * Actor Promotion Policy — Phase 4 Corrective v2
 * 
 * This module is now a THIN CLIENT WRAPPER.
 * All canonical truth and mutation logic lives in the
 * apply-actor-promotion edge function.
 * 
 * This module:
 * - Provides types for UI consumption
 * - Calls edge function for eligibility evaluation (read-only)
 * - Calls edge function for decision application (mutation)
 * - Provides query helpers for reading persisted truth
 * 
 * NO promotion logic or state mutation happens here.
 * 
 * IMPORTANT: The client-side evaluateActorPromotionEligibility function
 * is a UI-PREVIEW ONLY. It reads DB state to show eligibility status in
 * the UI without requiring an edge function call. The AUTHORITATIVE
 * evaluation happens inside the apply-actor-promotion edge function.
 * Both implementations follow the same rules but only the edge function
 * can authorize mutations.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Constants ────────────────────────────────────────────────────────────────

export const PROMOTION_POLICY_VERSION = 'phase4-corrective-v2';

// ── Types ────────────────────────────────────────────────────────────────────

export type PolicyDecisionStatus = 'not_eligible' | 'eligible' | 'review_required';
export type FinalDecisionStatus = 'pending_review' | 'approved' | 'rejected' | 'override_approved' | 'override_rejected' | 'revoked' | 'superseded';
export type DecisionMode = 'policy_auto' | 'manual_approve' | 'manual_reject' | 'override_approve' | 'override_reject' | 'revoke';

export interface PromotionEligibility {
  actor_id: string;
  actor_version_id: string | null;
  validation_run_id: string | null;
  validation_result_id: string | null;
  scoring_model: string | null;
  policy_version: string;
  eligible_for_promotion: boolean;
  review_required: boolean;
  block_reasons: string[];
  policy_decision_status: PolicyDecisionStatus;
}

export interface PromotionDecision {
  id: string;
  actor_id: string;
  actor_version_id: string;
  validation_run_id: string | null;
  validation_result_id: string | null;
  scoring_model: string;
  policy_version: string;
  eligible_for_promotion: boolean;
  review_required: boolean;
  block_reasons: string[];
  policy_decision_status: PolicyDecisionStatus;
  final_decision_status: FinalDecisionStatus;
  decision_mode: DecisionMode;
  override_reason: string | null;
  decision_note: string | null;
  decided_by: string | null;
  created_at: string;
}

export interface ActorPromotionState {
  promotion_status: string | null;
  roster_ready: boolean;
  approved_version_id: string | null;
  current_promotion_decision_id: string | null;
}

// ── Eligibility Evaluation (client-side read-only for UI display) ────────────

export type PromotionAction = 'approve' | 'reject' | 'override_approve' | 'override_reject' | 'revoke';

/**
 * Evaluate eligibility client-side for UI display ONLY.
 * This reads DB state but does NOT mutate anything.
 * The authoritative evaluation happens in the edge function.
 */
export async function evaluateActorPromotionEligibility(
  actorId: string,
  actorVersionId?: string,
): Promise<PromotionEligibility> {
  const blockReasons: string[] = [];

  // 1. Fetch actor PG gate statuses — no silent fallbacks
  const { data: actor, error: actorErr } = await (supabase as any)
    .from('ai_actors')
    .select('anchor_coverage_status, anchor_coherence_status')
    .eq('id', actorId)
    .single();

  if (actorErr || !actor) {
    return {
      actor_id: actorId,
      actor_version_id: null,
      validation_run_id: null,
      validation_result_id: null,
      scoring_model: null,
      policy_version: PROMOTION_POLICY_VERSION,
      eligible_for_promotion: false,
      review_required: false,
      block_reasons: ['actor_not_found'],
      policy_decision_status: 'not_eligible',
    };
  }

  if (!actor.anchor_coverage_status || actor.anchor_coverage_status === 'insufficient') {
    blockReasons.push('PG-00: Insufficient anchor coverage');
  }
  if (!actor.anchor_coherence_status || actor.anchor_coherence_status === 'incoherent') {
    blockReasons.push('PG-01: Anchor set incoherent');
  }

  // 2. Resolve version
  if (!actorVersionId) {
    const { data: versions } = await (supabase as any)
      .from('ai_actor_versions')
      .select('id')
      .eq('actor_id', actorId)
      .order('version_number', { ascending: false })
      .limit(1);
    actorVersionId = versions?.[0]?.id || null;
  }

  if (!actorVersionId) {
    blockReasons.push('actor_version_not_found');
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
      policy_decision_status: 'not_eligible',
    };
  }

  // 3. Fetch latest SCORED validation run for THIS VERSION (strict lineage)
  const { data: runs } = await (supabase as any)
    .from('actor_validation_runs')
    .select('id, status, actor_version_id')
    .eq('actor_id', actorId)
    .eq('actor_version_id', actorVersionId)
    .eq('status', 'scored')
    .order('created_at', { ascending: false })
    .limit(1);

  const scoredRun = runs?.[0];
  if (!scoredRun) {
    blockReasons.push('validation_run_missing: No scored validation run for this version');
  }

  // 4. Fetch validation result for that run
  let validationResult: any = null;
  if (scoredRun) {
    const { data: result } = await (supabase as any)
      .from('actor_validation_results')
      .select('id, promotable, hard_fail_codes, failure_reasons, scoring_model, overall_score')
      .eq('validation_run_id', scoredRun.id)
      .single();
    validationResult = result;
  }

  if (scoredRun && !validationResult) {
    blockReasons.push('validation_result_missing: Scored run exists but no result found');
  }

  if (validationResult && !validationResult.promotable) {
    blockReasons.push(`Validation result not promotable (score: ${validationResult.overall_score})`);
    if (validationResult.hard_fail_codes?.length > 0) {
      blockReasons.push(`Hard fails: ${validationResult.hard_fail_codes.join(', ')}`);
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
    actor_version_id: actorVersionId || null,
    validation_run_id: scoredRun?.id || null,
    validation_result_id: validationResult?.id || null,
    scoring_model: validationResult?.scoring_model || null,
    policy_version: PROMOTION_POLICY_VERSION,
    eligible_for_promotion: eligible,
    review_required: false,
    block_reasons: blockReasons,
    policy_decision_status: eligible ? 'eligible' : 'not_eligible',
  };
}

// ── Decision Application (delegates to edge function) ────────────────────────

export async function applyActorPromotionDecision(input: {
  actorId: string;
  actorVersionId?: string;
  action: PromotionAction;
  overrideReason?: string;
  decisionNote?: string;
}): Promise<PromotionDecision> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apply-actor-promotion`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        action: input.action,
        actorId: input.actorId,
        actorVersionId: input.actorVersionId,
        overrideReason: input.overrideReason,
        decisionNote: input.decisionNote,
      }),
    },
  );

  if (!resp.ok) {
    const text = await resp.text();
    let msg = 'Promotion action failed';
    try {
      msg = JSON.parse(text).error || msg;
    } catch {}
    throw new Error(msg);
  }

  const result = await resp.json();
  return result.decision;
}

// ── Query Helpers (read persisted truth) ──────────────────────────────────────

export async function getPromotionDecisions(actorId: string): Promise<PromotionDecision[]> {
  const { data } = await (supabase as any)
    .from('actor_promotion_decisions')
    .select('*')
    .eq('actor_id', actorId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getActorPromotionState(actorId: string): Promise<ActorPromotionState | null> {
  const { data } = await (supabase as any)
    .from('ai_actors')
    .select('promotion_status, roster_ready, approved_version_id, current_promotion_decision_id')
    .eq('id', actorId)
    .single();
  return data || null;
}
