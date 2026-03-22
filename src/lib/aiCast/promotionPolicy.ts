/**
 * Actor Promotion Policy — Phase 4
 * 
 * SINGLE SOURCE OF TRUTH for promotion eligibility evaluation
 * and promotion decision persistence.
 * 
 * Consumes:
 * - PG gate statuses (Phase 1)
 * - Validation results (Phase 3)
 * 
 * Produces:
 * - actor_promotion_decisions rows
 * - ai_actors promotion state updates
 * 
 * NO other module may duplicate this logic.
 */
import { supabase } from '@/integrations/supabase/client';

// ── Constants ────────────────────────────────────────────────────────────────

export const PROMOTION_POLICY_VERSION = 'phase4-v1';
const PROMOTABLE_SCORE_THRESHOLD = 75;

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
  promotion_status: string;
  roster_ready: boolean;
  approved_version_id: string | null;
  current_promotion_decision_id: string | null;
}

// ── Eligibility Evaluation ───────────────────────────────────────────────────

export async function evaluateActorPromotionEligibility(
  actorId: string,
  actorVersionId?: string,
): Promise<PromotionEligibility> {
  const blockReasons: string[] = [];

  // 1. Fetch actor PG gate statuses
  const { data: actor } = await (supabase as any)
    .from('ai_actors')
    .select('anchor_coverage_status, anchor_coherence_status')
    .eq('id', actorId)
    .single();

  const coverage = actor?.anchor_coverage_status || 'insufficient';
  const coherence = actor?.anchor_coherence_status || 'unknown';

  if (coverage === 'insufficient') {
    blockReasons.push('PG-00: Insufficient anchor coverage');
  }
  if (coherence === 'incoherent') {
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
    blockReasons.push('No actor version exists');
  }

  // 3. Fetch latest scored validation run
  const { data: latestRun } = await (supabase as any)
    .from('actor_validation_runs')
    .select('id, status')
    .eq('actor_id', actorId)
    .eq('status', 'scored')
    .order('created_at', { ascending: false })
    .limit(1);

  const scoredRun = latestRun?.[0];
  if (!scoredRun) {
    blockReasons.push('No scored validation run exists');
  }

  // 4. Fetch validation result
  let validationResult: any = null;
  if (scoredRun) {
    const { data: result } = await (supabase as any)
      .from('actor_validation_results')
      .select('id, promotable, hard_fail_codes, failure_reasons, scoring_model, overall_score')
      .eq('validation_run_id', scoredRun.id)
      .single();
    validationResult = result;
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

  if (scoredRun && !validationResult) {
    blockReasons.push('Scored run exists but no validation result found');
  }

  const eligible = blockReasons.length === 0;
  const reviewRequired = !eligible && coverage === 'partial';

  let policyStatus: PolicyDecisionStatus = 'not_eligible';
  if (eligible) policyStatus = 'eligible';
  else if (reviewRequired) policyStatus = 'review_required';

  return {
    actor_id: actorId,
    actor_version_id: actorVersionId || null,
    validation_run_id: scoredRun?.id || null,
    validation_result_id: validationResult?.id || null,
    scoring_model: validationResult?.scoring_model || null,
    policy_version: PROMOTION_POLICY_VERSION,
    eligible_for_promotion: eligible,
    review_required: reviewRequired,
    block_reasons: blockReasons,
    policy_decision_status: policyStatus,
  };
}

// ── Decision Write Flow ──────────────────────────────────────────────────────

export type PromotionAction = 'approve' | 'reject' | 'override_approve' | 'override_reject' | 'revoke';

interface ApplyDecisionInput {
  actorId: string;
  actorVersionId?: string;
  action: PromotionAction;
  overrideReason?: string;
  decisionNote?: string;
}

const ACTION_TO_MODE: Record<PromotionAction, DecisionMode> = {
  approve: 'manual_approve',
  reject: 'manual_reject',
  override_approve: 'override_approve',
  override_reject: 'override_reject',
  revoke: 'revoke',
};

const ACTION_TO_FINAL: Record<PromotionAction, FinalDecisionStatus> = {
  approve: 'approved',
  reject: 'rejected',
  override_approve: 'override_approved',
  override_reject: 'override_rejected',
  revoke: 'revoked',
};

export async function applyActorPromotionDecision(input: ApplyDecisionInput): Promise<PromotionDecision> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // 1. Evaluate eligibility
  const eligibility = await evaluateActorPromotionEligibility(input.actorId, input.actorVersionId);

  // Block non-override approve on ineligible actor
  if (input.action === 'approve' && !eligibility.eligible_for_promotion) {
    throw new Error(`Cannot approve: ${eligibility.block_reasons.join('; ')}`);
  }

  // Overrides require reason
  if ((input.action === 'override_approve' || input.action === 'override_reject') && !input.overrideReason?.trim()) {
    throw new Error('Override actions require a reason');
  }

  // Revoke requires existing approval
  if (input.action === 'revoke') {
    const { data: actor } = await (supabase as any)
      .from('ai_actors')
      .select('roster_ready')
      .eq('id', input.actorId)
      .single();
    if (!actor?.roster_ready) {
      throw new Error('Cannot revoke: actor is not currently roster-ready');
    }
  }

  const versionId = eligibility.actor_version_id;
  if (!versionId && input.action !== 'revoke') {
    throw new Error('No actor version available for promotion decision');
  }

  // 2. Supersede any existing active decisions for this actor
  await (supabase as any)
    .from('actor_promotion_decisions')
    .update({ final_decision_status: 'superseded' })
    .eq('actor_id', input.actorId)
    .in('final_decision_status', ['approved', 'override_approved', 'pending_review']);

  // 3. Insert decision
  const decisionRow = {
    actor_id: input.actorId,
    actor_version_id: versionId,
    validation_run_id: eligibility.validation_run_id,
    validation_result_id: eligibility.validation_result_id,
    scoring_model: eligibility.scoring_model || 'unknown',
    policy_version: PROMOTION_POLICY_VERSION,
    eligible_for_promotion: eligibility.eligible_for_promotion,
    review_required: eligibility.review_required,
    block_reasons: eligibility.block_reasons,
    policy_decision_status: eligibility.policy_decision_status,
    final_decision_status: ACTION_TO_FINAL[input.action],
    decision_mode: ACTION_TO_MODE[input.action],
    override_reason: input.overrideReason || null,
    decision_note: input.decisionNote || null,
    decided_by: user.id,
  };

  const { data: decision, error: insertErr } = await (supabase as any)
    .from('actor_promotion_decisions')
    .insert(decisionRow)
    .select('*')
    .single();

  if (insertErr || !decision) {
    throw new Error(insertErr?.message || 'Failed to persist promotion decision');
  }

  // 4. Update ai_actors current promotion state
  const isApproval = input.action === 'approve' || input.action === 'override_approve';
  const isRevoke = input.action === 'revoke';

  const actorUpdate: Record<string, any> = {
    current_promotion_decision_id: decision.id,
    promotion_policy_version: PROMOTION_POLICY_VERSION,
    promotion_updated_at: new Date().toISOString(),
  };

  if (isApproval) {
    actorUpdate.promotion_status = decision.final_decision_status;
    actorUpdate.approved_version_id = versionId;
    actorUpdate.roster_ready = true;
  } else if (isRevoke) {
    actorUpdate.promotion_status = 'revoked';
    actorUpdate.approved_version_id = null;
    actorUpdate.roster_ready = false;
  } else {
    // reject / override_reject
    actorUpdate.promotion_status = decision.final_decision_status;
    // Don't touch approved_version_id or roster_ready on rejection
    // unless actor wasn't previously approved
  }

  await (supabase as any)
    .from('ai_actors')
    .update(actorUpdate)
    .eq('id', input.actorId);

  return decision;
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

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
