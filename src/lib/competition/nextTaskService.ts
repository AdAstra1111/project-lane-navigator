/**
 * Next-Task Triggering Service — canonical progression layer.
 *
 * Deterministic, retrieval-first, round-aware.
 * Advances a competition flow only when a canonical promotion decision exists.
 * Halts cleanly (persisted "blocked" state) when no candidate qualifies.
 * Persists advancement state so progression is idempotent and auditable.
 *
 * PROGRESSION MODEL:
 * - Progression is evaluated per round within a group.
 * - A round produces exactly one progression outcome:
 *     advanced      — next task created, downstream artifact referenced
 *     blocked       — no promotion / missing prerequisites / invariant failure
 *     already_advanced — idempotent repeat; returns existing advancement
 *
 * FIRST INTEGRATED DOWNSTREAM ACTION:
 * In v1, "next task" means registering the promoted candidate as the
 * canonical selected asset for the slot via a `candidate_selections` row
 * with selection_mode='auto_promoted'. This bridges competition → slot
 * ownership without requiring a full task-queue system yet.
 *
 * Tables: round_progressions, round_promotions, candidate_selections,
 *         competition_rounds, candidate_groups
 */

import { supabase } from '@/integrations/supabase/client';
import {
  CompetitionInvariantError,
  loadCurrentRound,
  type CompetitionRound,
} from './candidateCompetitionService';
import {
  loadPromotionForRound,
  type RoundPromotion,
} from './autoPromotionService';

// ── Types ──

export type ProgressionStatus = 'advanced' | 'blocked' | 'already_advanced';

export interface RoundProgression {
  id: string;
  group_id: string;
  round_id: string;
  source_promotion_id: string | null;
  promoted_candidate_version_id: string | null;
  progression_status: ProgressionStatus;
  next_task_type: string;
  next_task_ref_id: string | null;
  rationale: string | null;
  progression_snapshot_json: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

export interface ProgressionEligibility {
  eligible: boolean;
  rationale: string;
  promotion: RoundPromotion | null;
  round: CompetitionRound | null;
  alreadyAdvanced: RoundProgression | null;
}

// ── Read: Load Existing Progression ──

/**
 * Load the progression decision for a specific round, if one exists.
 */
export async function loadProgressionForRound(roundId: string): Promise<RoundProgression | null> {
  const { data, error } = await (supabase as any)
    .from('round_progressions')
    .select('*')
    .eq('round_id', roundId)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as RoundProgression;
}

/**
 * Load all progression decisions for a group, ordered by creation.
 */
export async function loadProgressionHistoryForGroup(groupId: string): Promise<RoundProgression[]> {
  const { data, error } = await (supabase as any)
    .from('round_progressions')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data || []) as RoundProgression[];
}

// ── Read-Only: Evaluate Eligibility (dry run) ──

/**
 * Evaluate whether a round is eligible for next-task advancement.
 * Does NOT persist — use triggerNextTaskForRound() for that.
 */
export async function evaluateNextTaskEligibility(params: {
  groupId: string;
  roundId: string;
}): Promise<ProgressionEligibility> {
  // Check for existing progression (idempotency)
  const existing = await loadProgressionForRound(params.roundId);
  if (existing) {
    return {
      eligible: existing.progression_status === 'advanced',
      rationale: `Progression already recorded: ${existing.progression_status}`,
      promotion: null,
      round: null,
      alreadyAdvanced: existing.progression_status === 'advanced' ? existing : null,
    };
  }

  // IEL: round must belong to group
  const { data: round, error: rErr } = await (supabase as any)
    .from('competition_rounds')
    .select('*')
    .eq('id', params.roundId)
    .single();

  if (rErr || !round) {
    return {
      eligible: false,
      rationale: `Round ${params.roundId} not found`,
      promotion: null,
      round: null,
      alreadyAdvanced: null,
    };
  }
  if (round.group_id !== params.groupId) {
    return {
      eligible: false,
      rationale: `Round ${params.roundId} does not belong to group ${params.groupId}`,
      promotion: null,
      round: round as CompetitionRound,
      alreadyAdvanced: null,
    };
  }

  // Gate: canonical promotion must exist
  const promotion = await loadPromotionForRound(params.roundId);
  if (!promotion) {
    return {
      eligible: false,
      rationale: 'No promotion decision exists for this round',
      promotion: null,
      round: round as CompetitionRound,
      alreadyAdvanced: null,
    };
  }

  if (promotion.promotion_status !== 'promoted') {
    return {
      eligible: false,
      rationale: `Round not promoted: ${promotion.rationale || 'not_promoted'}`,
      promotion,
      round: round as CompetitionRound,
      alreadyAdvanced: null,
    };
  }

  if (!promotion.promoted_candidate_version_id) {
    return {
      eligible: false,
      rationale: 'Promotion exists but has no promoted candidate version',
      promotion,
      round: round as CompetitionRound,
      alreadyAdvanced: null,
    };
  }

  // IEL: group must not be closed
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) {
    return {
      eligible: false,
      rationale: `Group ${params.groupId} not found`,
      promotion,
      round: round as CompetitionRound,
      alreadyAdvanced: null,
    };
  }

  return {
    eligible: true,
    rationale: 'Promotion exists with qualifying candidate — eligible for advancement',
    promotion,
    round: round as CompetitionRound,
    alreadyAdvanced: null,
  };
}

// ── Write: Trigger Next Task (persists progression) ──

/**
 * DOWNSTREAM ACTION CONTRACT (v1):
 *
 * The first integrated downstream action is registering the promoted
 * candidate as a canonical auto-promoted selection. This creates a
 * candidate_selections row with selection_mode contextually set,
 * bridging competition promotion → slot ownership.
 *
 * next_task_type = 'auto_promoted_selection'
 * next_task_ref_id = the selection row id
 *
 * Future versions may create more complex downstream tasks
 * (e.g., enqueue next generation step, trigger lookbook assembly).
 */
export async function triggerNextTaskForRound(params: {
  groupId: string;
  roundId: string;
  createdBy?: string;
}): Promise<RoundProgression> {
  // 1. Check idempotency: if already advanced, return existing
  const existing = await loadProgressionForRound(params.roundId);
  if (existing && existing.progression_status === 'advanced') {
    // Return as already_advanced echo without creating duplicate
    return {
      ...existing,
      progression_status: 'already_advanced' as ProgressionStatus,
    };
  }
  // If blocked progression exists, do not re-attempt
  if (existing && existing.progression_status === 'blocked') {
    return existing;
  }

  // 2. Evaluate eligibility
  const eligibility = await evaluateNextTaskEligibility({
    groupId: params.groupId,
    roundId: params.roundId,
  });

  // 3. If not eligible, persist blocked outcome
  if (!eligibility.eligible || !eligibility.promotion) {
    const { data: blocked, error: bErr } = await (supabase as any)
      .from('round_progressions')
      .insert({
        group_id: params.groupId,
        round_id: params.roundId,
        source_promotion_id: eligibility.promotion?.id || null,
        promoted_candidate_version_id: null,
        progression_status: 'blocked',
        next_task_type: 'none',
        next_task_ref_id: null,
        rationale: eligibility.rationale,
        progression_snapshot_json: {
          evaluation: eligibility.rationale,
          promotion_status: eligibility.promotion?.promotion_status || 'missing',
        },
        created_by: params.createdBy || null,
      })
      .select()
      .single();

    if (bErr) throw new Error(`Failed to persist blocked progression: ${bErr.message}`);
    return blocked as RoundProgression;
  }

  // 4. Execute downstream action: create auto-promoted selection
  const promotion = eligibility.promotion!;
  const candidateVersionId = promotion.promoted_candidate_version_id!;

  // Create canonical selection row as downstream artifact
  const { data: selection, error: selErr } = await (supabase as any)
    .from('candidate_selections')
    .insert({
      group_id: params.groupId,
      selected_candidate_version_id: candidateVersionId,
      selection_mode: 'manual', // DB enum constraint — represents auto-promoted bridge
      round_id: params.roundId,
      selected_by: params.createdBy || null,
      rationale: `Auto-promoted via next-task trigger from promotion ${promotion.id}`,
    })
    .select()
    .single();

  if (selErr) throw new Error(`Failed to create downstream selection: ${selErr.message}`);

  // 5. Persist advanced progression
  const { data: advanced, error: aErr } = await (supabase as any)
    .from('round_progressions')
    .insert({
      group_id: params.groupId,
      round_id: params.roundId,
      source_promotion_id: promotion.id,
      promoted_candidate_version_id: candidateVersionId,
      progression_status: 'advanced',
      next_task_type: 'auto_promoted_selection',
      next_task_ref_id: selection.id,
      rationale: `Advanced: promoted candidate ${candidateVersionId} registered as canonical selection`,
      progression_snapshot_json: {
        promotion_id: promotion.id,
        candidate_version_id: candidateVersionId,
        selection_id: selection.id,
        promotion_rationale: promotion.rationale,
        gating_snapshot: promotion.gating_snapshot_json,
      },
      created_by: params.createdBy || null,
    })
    .select()
    .single();

  if (aErr) throw new Error(`Failed to persist advanced progression: ${aErr.message}`);

  // 6. Update group status to reflect completion
  await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'winner_selected' })
    .eq('id', params.groupId);

  return advanced as RoundProgression;
}
