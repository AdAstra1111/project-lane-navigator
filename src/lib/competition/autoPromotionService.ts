/**
 * Auto-Promotion Service — canonical automatic promotion evaluation and persistence.
 *
 * Deterministic, retrieval-first, round-aware.
 * Evaluates whether the top-ranked candidate in a round satisfies hard promotion gates.
 * Persists both promoted and not_promoted outcomes as canonical decision artifacts.
 *
 * PROMOTION MODEL:
 * - Promotion is evaluated per round, not per group.
 * - A round results in exactly one of: promoted | not_promoted.
 * - Promotion requires explicit gate satisfaction, not merely top rank.
 * - No-promotion is a first-class canonical outcome with persisted reason.
 * - Manual selection remains compatible as a parallel path with distinct provenance.
 *
 * EFFECTIVE WINNER RESOLUTION:
 * The effective winner for a group is resolved via:
 *   1. Current round's promotion decision (if promoted)
 *   2. Current round's manual selection (if exists, as fallback bridge)
 *   3. Most recent completed round's promotion (if current round has none)
 *   4. None — no effective winner
 *
 * Tables: round_promotions, candidate_rankings, candidate_selections,
 *         competition_rounds, candidate_groups
 *
 * No auto-promotion of ladder progression. No next-task triggering.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  CompetitionInvariantError,
  loadCurrentRound,
  type CandidateRanking,
  type CandidateSelection,
  type CompetitionRound,
} from './candidateCompetitionService';

// ── Types ──

export type PromotionMode = 'auto' | 'manual_override';
export type PromotionStatus = 'promoted' | 'not_promoted';

export interface RoundPromotion {
  id: string;
  group_id: string;
  round_id: string;
  promoted_candidate_version_id: string | null;
  promotion_mode: PromotionMode;
  promotion_status: PromotionStatus;
  gating_snapshot_json: Record<string, unknown>;
  rationale: string | null;
  created_at: string;
  created_by: string | null;
}

/**
 * PROMOTION GATE POLICY:
 *
 * A candidate is promotable when ALL of the following are satisfied:
 *   1. The round has at least one persisted ranking.
 *   2. The top-ranked candidate (rank_position = 1) exists.
 *   3. The top candidate's rank_score >= MINIMUM_RANK_SCORE.
 *   4. If score_json contains identity-related signals, they must not indicate drift.
 *
 * THRESHOLD RATIONALE:
 * - MINIMUM_RANK_SCORE of 40 represents a baseline quality floor.
 *   Candidates below this consistently show identity drift, weak similarity,
 *   or poor slot fitness in the existing ranking model.
 * - The identity_drift check uses existing canonical continuity classification
 *   already persisted in score_json by the ranking pipeline.
 *
 * These thresholds can be refined per ranking_policy_key in the future
 * without changing the promotion architecture.
 */
export interface PromotionGatePolicy {
  minimumRankScore: number;
  blockOnIdentityDrift: boolean;
  policyKey: string;
}

const DEFAULT_GATE_POLICY: PromotionGatePolicy = {
  minimumRankScore: 40,
  blockOnIdentityDrift: true,
  policyKey: 'default_v1',
};

export interface PromotionEvaluation {
  eligible: boolean;
  candidateVersionId: string | null;
  rankScore: number | null;
  gatingSnapshot: Record<string, unknown>;
  rationale: string;
}

// ── Gate Evaluation (pure, deterministic) ──

/**
 * Evaluate whether the top-ranked candidate in a set of rankings
 * passes the promotion gates. Pure function — no side effects.
 */
export function evaluatePromotionGates(
  rankings: CandidateRanking[],
  policy: PromotionGatePolicy = DEFAULT_GATE_POLICY,
): PromotionEvaluation {
  if (rankings.length === 0) {
    return {
      eligible: false,
      candidateVersionId: null,
      rankScore: null,
      gatingSnapshot: { policy: policy.policyKey, reason: 'no_rankings' },
      rationale: 'No rankings available for this round',
    };
  }

  // Find top-ranked candidate (lowest rank_position = best)
  const sorted = [...rankings].sort((a, b) => a.rank_position - b.rank_position);
  const top = sorted[0];

  const snapshot: Record<string, unknown> = {
    policy: policy.policyKey,
    candidate_version_id: top.candidate_version_id,
    rank_position: top.rank_position,
    rank_score: top.rank_score,
    minimum_rank_score: policy.minimumRankScore,
    total_candidates: rankings.length,
  };

  // Gate 1: minimum rank score
  if (top.rank_score < policy.minimumRankScore) {
    return {
      eligible: false,
      candidateVersionId: top.candidate_version_id,
      rankScore: top.rank_score,
      gatingSnapshot: { ...snapshot, failed_gate: 'minimum_rank_score' },
      rationale: `Top candidate rank_score ${top.rank_score} below threshold ${policy.minimumRankScore}`,
    };
  }

  // Gate 2: identity drift block
  if (policy.blockOnIdentityDrift) {
    const scoreJson = (top.score_json || {}) as Record<string, unknown>;
    const continuityClass = scoreJson.identity_continuity || scoreJson.continuity_class;
    if (continuityClass === 'identity_drift') {
      snapshot.identity_continuity = continuityClass;
      return {
        eligible: false,
        candidateVersionId: top.candidate_version_id,
        rankScore: top.rank_score,
        gatingSnapshot: { ...snapshot, failed_gate: 'identity_drift' },
        rationale: 'Top candidate has identity drift — promotion blocked',
      };
    }
    snapshot.identity_continuity = continuityClass || 'not_evaluated';
  }

  return {
    eligible: true,
    candidateVersionId: top.candidate_version_id,
    rankScore: top.rank_score,
    gatingSnapshot: { ...snapshot, passed: true },
    rationale: `Top candidate passes all gates (score: ${top.rank_score}, policy: ${policy.policyKey})`,
  };
}

// ── Evaluate Round Promotion (service, reads DB) ──

/**
 * Evaluate promotion eligibility for a specific round.
 * Does NOT persist — use autoPromoteRound() for that.
 */
export async function evaluateRoundPromotion(params: {
  groupId: string;
  roundId: string;
  policy?: PromotionGatePolicy;
}): Promise<PromotionEvaluation> {
  // IEL: round must belong to group
  const { data: round, error: rErr } = await (supabase as any)
    .from('competition_rounds')
    .select('id, group_id, status')
    .eq('id', params.roundId)
    .single();

  if (rErr || !round) throw new CompetitionInvariantError(`Round ${params.roundId} not found`);
  if (round.group_id !== params.groupId) {
    throw new CompetitionInvariantError(`Round ${params.roundId} does not belong to group ${params.groupId}`);
  }

  // Load rankings for this round
  const { data: rankings, error: rkErr } = await (supabase as any)
    .from('candidate_rankings')
    .select('*')
    .eq('group_id', params.groupId)
    .eq('round_id', params.roundId)
    .order('rank_position', { ascending: true });

  if (rkErr) throw new Error(`Failed to load rankings: ${rkErr.message}`);

  return evaluatePromotionGates(
    (rankings || []) as CandidateRanking[],
    params.policy || DEFAULT_GATE_POLICY,
  );
}

// ── Auto-Promote Round (persists decision) ──

/**
 * Evaluate and persist a promotion decision for a round.
 * Persists both promoted and not_promoted outcomes canonically.
 * IEL: at most one promotion per round (unique index enforced by DB).
 */
export async function autoPromoteRound(params: {
  groupId: string;
  roundId: string;
  policy?: PromotionGatePolicy;
  createdBy?: string;
}): Promise<RoundPromotion> {
  // IEL: group must exist and not be closed
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) throw new CompetitionInvariantError(`Group ${params.groupId} not found`);
  if (group.status === 'closed') {
    throw new CompetitionInvariantError(`Cannot promote in closed group ${params.groupId}`);
  }

  // IEL: check for existing promotion for this round
  const { data: existing } = await (supabase as any)
    .from('round_promotions')
    .select('id')
    .eq('round_id', params.roundId)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new CompetitionInvariantError(
      `Promotion decision already exists for round ${params.roundId}`
    );
  }

  // Evaluate gates
  const evaluation = await evaluateRoundPromotion({
    groupId: params.groupId,
    roundId: params.roundId,
    policy: params.policy,
  });

  // Persist decision
  const { data, error } = await (supabase as any)
    .from('round_promotions')
    .insert({
      group_id: params.groupId,
      round_id: params.roundId,
      promoted_candidate_version_id: evaluation.eligible ? evaluation.candidateVersionId : null,
      promotion_mode: 'auto',
      promotion_status: evaluation.eligible ? 'promoted' : 'not_promoted',
      gating_snapshot_json: evaluation.gatingSnapshot,
      rationale: evaluation.rationale,
      created_by: params.createdBy || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to persist promotion decision: ${error.message}`);

  // If promoted, also update group status to winner_selected for UI compat
  if (evaluation.eligible) {
    await (supabase as any)
      .from('candidate_groups')
      .update({ status: 'winner_selected' })
      .eq('id', params.groupId);
  }

  return data as RoundPromotion;
}

// ── Load Promotion Decisions ──

/**
 * Load the promotion decision for a specific round, if one exists.
 */
export async function loadPromotionForRound(roundId: string): Promise<RoundPromotion | null> {
  const { data, error } = await (supabase as any)
    .from('round_promotions')
    .select('*')
    .eq('round_id', roundId)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as RoundPromotion;
}

/**
 * Load all promotion decisions for a group, ordered by creation.
 */
export async function loadPromotionHistory(groupId: string): Promise<RoundPromotion[]> {
  const { data, error } = await (supabase as any)
    .from('round_promotions')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data || []) as RoundPromotion[];
}

// ── Effective Winner Resolution ──

/**
 * EFFECTIVE WINNER RESOLUTION CONTRACT:
 *
 * Resolves the current effective winner for a group deterministically.
 *
 * Precedence order:
 *   1. Promotion from the current active round (if promoted)
 *   2. Manual selection from the current active round (bridge compat)
 *   3. Promotion from the most recently completed round (if promoted)
 *   4. Manual selection from the most recently completed round (bridge compat)
 *   5. None — no effective winner
 *
 * This ensures auto-promotion is the canonical path while preserving
 * manual selection compatibility during the v0.5→v1 bridge period.
 */
export interface EffectiveWinner {
  candidateVersionId: string;
  source: 'auto_promotion' | 'manual_selection';
  roundId: string;
  rationale: string | null;
}

export async function resolveEffectiveWinner(groupId: string): Promise<EffectiveWinner | null> {
  // Load rounds ordered by round_index desc (most recent first)
  const { data: rounds } = await (supabase as any)
    .from('competition_rounds')
    .select('*')
    .eq('group_id', groupId)
    .in('status', ['active', 'completed'])
    .order('round_index', { ascending: false });

  if (!rounds || rounds.length === 0) return null;

  // Check each round for promotion, then manual selection
  for (const round of rounds) {
    // Check promotion
    const { data: promos } = await (supabase as any)
      .from('round_promotions')
      .select('*')
      .eq('round_id', round.id)
      .eq('promotion_status', 'promoted')
      .limit(1);

    if (promos && promos.length > 0 && promos[0].promoted_candidate_version_id) {
      return {
        candidateVersionId: promos[0].promoted_candidate_version_id,
        source: 'auto_promotion',
        roundId: round.id,
        rationale: promos[0].rationale,
      };
    }

    // Check manual selection
    const { data: selections } = await (supabase as any)
      .from('candidate_selections')
      .select('*')
      .eq('group_id', groupId)
      .eq('round_id', round.id)
      .order('selected_at', { ascending: false })
      .limit(1);

    if (selections && selections.length > 0) {
      return {
        candidateVersionId: selections[0].selected_candidate_version_id,
        source: 'manual_selection',
        roundId: round.id,
        rationale: selections[0].rationale,
      };
    }
  }

  return null;
}

// ── Export policy for testing ──

export { DEFAULT_GATE_POLICY };
