/**
 * Repair Loop Service v1 — canonical repair lifecycle operations.
 *
 * Deterministic, retrieval-first, round-aware.
 * Creates repair-designated competition rounds for weak candidates.
 * Enforces retry caps and lineage provenance.
 *
 * Tables: repair_runs, repair_targets, candidate_versions (lineage),
 *         competition_rounds (repair type), candidate_groups
 *
 * REPAIR MODEL:
 * - A repair run is scoped to one candidate_group.
 * - It references a source_round (the ranked round whose weak candidates triggered repair).
 * - It creates a repair_round (new competition_round of type 'repair').
 * - Repair targets identify which source candidates need improvement and why.
 * - Repaired candidates are new candidate_versions with lineage to their source.
 * - Retry cap is enforced per group.
 *
 * No auto-promotion. No next-task triggering. Human selects winner.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  CompetitionInvariantError,
  createRerunRound,
  loadCurrentRound,
  type CompetitionRound,
  type CandidateVersion,
} from './candidateCompetitionService';

// ── Types ──

export type RepairStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RepairRun {
  id: string;
  group_id: string;
  source_round_id: string;
  repair_round_id: string | null;
  repair_policy_key: string;
  status: RepairStatus;
  attempt_index: number;
  max_attempts: number;
  created_at: string;
  created_by: string | null;
}

export interface RepairTarget {
  id: string;
  repair_run_id: string;
  source_candidate_version_id: string;
  target_rank_position: number | null;
  target_reason_key: string;
  diagnostics_json: Record<string, unknown>;
  created_at: string;
}

export interface RepairTargetInput {
  sourceCandidateVersionId: string;
  targetRankPosition?: number;
  targetReasonKey: string;
  diagnosticsJson?: Record<string, unknown>;
}

// ── Constants ──

const DEFAULT_MAX_REPAIR_ATTEMPTS = 3;

// ── Retry Cap Check ──

/**
 * RETRY CAP ACCOUNTING POLICY:
 *
 * Statuses that COUNT toward the cap:
 *   - pending   (attempt initiated, resources committed)
 *   - running   (actively executing)
 *   - completed (finished successfully)
 *   - failed    (finished unsuccessfully — still consumed an attempt)
 *
 * Statuses that DO NOT count:
 *   - cancelled (explicitly withdrawn before meaningful work; does not consume the attempt)
 *
 * RATIONALE: Failed attempts are real attempts that consumed compute/evaluation resources.
 * Excluding them would allow infinite retries by failing repeatedly, making the cap meaningless.
 * Cancelled attempts are explicitly withdrawn by user/operator before meaningful execution,
 * so they are not counted to avoid penalizing legitimate workflow corrections.
 */
const COUNTED_REPAIR_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

async function countRepairAttempts(groupId: string): Promise<number> {
  const { count, error } = await (supabase as any)
    .from('repair_runs')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
    .in('status', [...COUNTED_REPAIR_STATUSES]);

  if (error) throw new Error(`Failed to count repair attempts: ${error.message}`);
  return count ?? 0;
}

// ── Load Repair History ──

export async function loadRepairHistory(groupId: string): Promise<RepairRun[]> {
  const { data, error } = await (supabase as any)
    .from('repair_runs')
    .select('*')
    .eq('group_id', groupId)
    .order('attempt_index', { ascending: true });

  if (error) return [];
  return (data || []) as RepairRun[];
}

export async function loadRepairTargets(repairRunId: string): Promise<RepairTarget[]> {
  const { data, error } = await (supabase as any)
    .from('repair_targets')
    .select('*')
    .eq('repair_run_id', repairRunId)
    .order('target_rank_position', { ascending: false });

  if (error) return [];
  return (data || []) as RepairTarget[];
}

// ── Create Repair Run ──

/**
 * Create a new repair run for a group from a specific source round.
 * IEL enforced: validates group, source round, and retry cap.
 */
export async function createRepairRun(params: {
  groupId: string;
  sourceRoundId: string;
  repairPolicyKey?: string;
  maxAttempts?: number;
  createdBy?: string;
}): Promise<RepairRun> {
  const maxAttempts = params.maxAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;

  // IEL: group must exist and not be closed
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) throw new CompetitionInvariantError(`Group ${params.groupId} not found`);
  if (group.status === 'closed') {
    throw new CompetitionInvariantError(`Cannot create repair run for closed group ${params.groupId}`);
  }

  // IEL: source round must belong to this group
  const { data: sourceRound, error: srErr } = await (supabase as any)
    .from('competition_rounds')
    .select('id, group_id')
    .eq('id', params.sourceRoundId)
    .single();

  if (srErr || !sourceRound) {
    throw new CompetitionInvariantError(`Source round ${params.sourceRoundId} not found`);
  }
  if (sourceRound.group_id !== params.groupId) {
    throw new CompetitionInvariantError(
      `Source round ${params.sourceRoundId} does not belong to group ${params.groupId}`
    );
  }

  // IEL: enforce retry cap
  const attemptCount = await countRepairAttempts(params.groupId);
  if (attemptCount >= maxAttempts) {
    throw new CompetitionInvariantError(
      `Repair retry cap reached for group ${params.groupId}: ${attemptCount}/${maxAttempts} attempts used`
    );
  }

  const { data, error } = await (supabase as any)
    .from('repair_runs')
    .insert({
      group_id: params.groupId,
      source_round_id: params.sourceRoundId,
      repair_policy_key: params.repairPolicyKey || 'default',
      status: 'pending',
      attempt_index: attemptCount,
      max_attempts: maxAttempts,
      created_by: params.createdBy || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create repair run: ${error.message}`);
  return data as RepairRun;
}

// ── Derive Repair Targets ──

/**
 * Identify weak candidates from a source round's rankings.
 * Deterministic: selects bottom-K candidates by rank_score.
 */
export async function deriveRepairTargetsFromRound(params: {
  repairRunId: string;
  groupId: string;
  sourceRoundId: string;
  targetCount?: number;
  scoreThreshold?: number;
}): Promise<RepairTarget[]> {
  const targetCount = params.targetCount ?? 2;

  // IEL: repair run must be pending
  const { data: run, error: runErr } = await (supabase as any)
    .from('repair_runs')
    .select('id, status, group_id')
    .eq('id', params.repairRunId)
    .single();

  if (runErr || !run) throw new CompetitionInvariantError(`Repair run ${params.repairRunId} not found`);
  if (run.status !== 'pending') {
    throw new CompetitionInvariantError(`Repair run ${params.repairRunId} is not pending (status: ${run.status})`);
  }
  if (run.group_id !== params.groupId) {
    throw new CompetitionInvariantError(`Repair run ${params.repairRunId} does not belong to group ${params.groupId}`);
  }

  // Load rankings for source round, ordered by rank_score ascending (weakest first)
  const rankQuery = (supabase as any)
    .from('candidate_rankings')
    .select('*')
    .eq('group_id', params.groupId)
    .order('rank_score', { ascending: true });

  // Filter by round if available
  if (params.sourceRoundId) {
    rankQuery.eq('round_id', params.sourceRoundId);
  }

  const { data: rankings, error: rErr } = await rankQuery;
  if (rErr) throw new Error(`Failed to load rankings: ${rErr.message}`);

  if (!rankings || rankings.length === 0) {
    throw new CompetitionInvariantError(
      `No rankings found for group ${params.groupId} round ${params.sourceRoundId}`
    );
  }

  // Select weakest candidates up to targetCount
  let weakCandidates = rankings.slice(0, targetCount);

  // If scoreThreshold provided, filter to only those below threshold
  if (params.scoreThreshold !== undefined) {
    weakCandidates = weakCandidates.filter((r: any) => r.rank_score < params.scoreThreshold!);
  }

  if (weakCandidates.length === 0) {
    // All candidates above threshold — no repair targets needed
    return [];
  }

  // Persist repair targets
  const targetRows = weakCandidates.map((r: any) => ({
    repair_run_id: params.repairRunId,
    source_candidate_version_id: r.candidate_version_id,
    target_rank_position: r.rank_position,
    target_reason_key: deriveReasonKey(r),
    diagnostics_json: {
      rank_score: r.rank_score,
      rank_position: r.rank_position,
      score_json: r.score_json || {},
    },
  }));

  const { data: targets, error: tErr } = await (supabase as any)
    .from('repair_targets')
    .insert(targetRows)
    .select();

  if (tErr) throw new Error(`Failed to persist repair targets: ${tErr.message}`);
  return (targets || []) as RepairTarget[];
}

/**
 * Derive a reason key from ranking data.
 */
function deriveReasonKey(ranking: any): string {
  const score = ranking.rank_score ?? 0;
  const scoreJson = ranking.score_json || {};

  if (score < 30) return 'very_low_score';
  if (score < 50) return 'low_score';
  if (scoreJson.identity_continuity === 'identity_drift') return 'identity_drift';
  if (scoreJson.continuity_class === 'identity_drift') return 'identity_drift';
  if (scoreJson.visual_similarity_composite !== undefined && scoreJson.visual_similarity_composite < 0.4) {
    return 'weak_similarity';
  }
  return 'below_threshold';
}

// ── Create Repair Round ──

/**
 * Create a repair-designated competition round for this repair run.
 *
 * REPAIR-ROUND LIFECYCLE CONTRACT:
 * A repair round is a specialized rerun round, distinguished by round_type='repair'.
 * It reuses createRerunRound() because the lifecycle mechanics are identical:
 *   - supersede the current active round
 *   - create a new round with incremented round_index
 *   - reset group status to 'open'
 *   - set source_round_id for lineage
 *
 * What makes repair distinct from a plain rerun:
 *   1. round_type is 'repair' (not 'rerun'), enabling audit queries
 *   2. A repair_run record links the round to repair targets + diagnostics
 *   3. Candidates created for this round carry creation_mode='repair' + source lineage
 *   4. The repair_run tracks attempt_index for retry cap enforcement
 *
 * Invariants shared with rerun rounds:
 *   - exactly one active round per group (enforced by DB partial unique index)
 *   - prior round becomes 'superseded' and is immutable
 *   - group status resets to 'open' for the new round
 *
 * This reuse is intentional and justified — repair does not need a separate
 * round creation path because the round-level state machine is identical.
 * Repair-specific semantics live in repair_runs/repair_targets, not in the round itself.
 */
export async function createRepairRound(params: {
  repairRunId: string;
  groupId: string;
  createdBy?: string;
}): Promise<CompetitionRound> {
  // IEL: repair run must be pending or running
  const { data: run, error: runErr } = await (supabase as any)
    .from('repair_runs')
    .select('id, status, group_id, repair_round_id')
    .eq('id', params.repairRunId)
    .single();

  if (runErr || !run) throw new CompetitionInvariantError(`Repair run ${params.repairRunId} not found`);
  if (!['pending', 'running'].includes(run.status)) {
    throw new CompetitionInvariantError(`Repair run ${params.repairRunId} cannot create round (status: ${run.status})`);
  }
  if (run.group_id !== params.groupId) {
    throw new CompetitionInvariantError(`Repair run does not belong to group ${params.groupId}`);
  }
  // IEL: prevent double round creation
  if (run.repair_round_id) {
    throw new CompetitionInvariantError(
      `Repair run ${params.repairRunId} already has a repair round (${run.repair_round_id})`
    );
  }

  // Create repair round using existing round infrastructure (justified reuse — see contract above)
  const round = await createRerunRound({
    groupId: params.groupId,
    roundType: 'repair' as any,
    createdBy: params.createdBy,
  });

  // Link repair round to repair run and transition to running
  await (supabase as any)
    .from('repair_runs')
    .update({
      repair_round_id: round.id,
      status: 'running',
    })
    .eq('id', params.repairRunId);

  return round;
}

// ── Register Repaired Candidate ──

/**
 * Register a repaired candidate with lineage to its source.
 */
export async function registerRepairedCandidate(params: {
  groupId: string;
  versionRefId: string;
  sourceCandidateVersionId: string;
  sourceRunId?: string;
  versionRefType?: string;
}): Promise<CandidateVersion> {
  // IEL: group must not be closed
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) throw new CompetitionInvariantError(`Group ${params.groupId} not found`);
  if (group.status === 'closed') {
    throw new CompetitionInvariantError(`Cannot add repaired candidate to closed group ${params.groupId}`);
  }

  // IEL: source candidate must belong to same group
  const { data: sourceCV, error: scvErr } = await (supabase as any)
    .from('candidate_versions')
    .select('id, group_id')
    .eq('id', params.sourceCandidateVersionId)
    .single();

  if (scvErr || !sourceCV) {
    throw new CompetitionInvariantError(`Source candidate ${params.sourceCandidateVersionId} not found`);
  }
  if (sourceCV.group_id !== params.groupId) {
    throw new CompetitionInvariantError(
      `Source candidate ${params.sourceCandidateVersionId} does not belong to group ${params.groupId}`
    );
  }

  // Get next candidate_index
  const { data: maxIdx } = await (supabase as any)
    .from('candidate_versions')
    .select('candidate_index')
    .eq('group_id', params.groupId)
    .order('candidate_index', { ascending: false })
    .limit(1);

  const nextIndex = (maxIdx && maxIdx.length > 0) ? maxIdx[0].candidate_index + 1 : 0;

  const { data, error } = await (supabase as any)
    .from('candidate_versions')
    .insert({
      group_id: params.groupId,
      version_ref_type: params.versionRefType || 'project_image',
      version_ref_id: params.versionRefId,
      candidate_index: nextIndex,
      source_run_id: params.sourceRunId || null,
      source_candidate_version_id: params.sourceCandidateVersionId,
      creation_mode: 'repair',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to register repaired candidate: ${error.message}`);
  return data as CandidateVersion;
}

// ── Finalize / Fail Repair Run ──

export async function finalizeRepairRun(repairRunId: string): Promise<RepairRun> {
  // IEL: must be running
  const { data: run, error: runErr } = await (supabase as any)
    .from('repair_runs')
    .select('*')
    .eq('id', repairRunId)
    .single();

  if (runErr || !run) throw new CompetitionInvariantError(`Repair run ${repairRunId} not found`);
  if (run.status !== 'running') {
    throw new CompetitionInvariantError(`Cannot finalize repair run ${repairRunId} (status: ${run.status})`);
  }

  // IEL: must have at least one repair target
  const { count } = await (supabase as any)
    .from('repair_targets')
    .select('id', { count: 'exact', head: true })
    .eq('repair_run_id', repairRunId);

  if ((count ?? 0) === 0) {
    throw new CompetitionInvariantError(`Repair run ${repairRunId} has no targets — use failRepairRun instead`);
  }

  const { data, error } = await (supabase as any)
    .from('repair_runs')
    .update({ status: 'completed' })
    .eq('id', repairRunId)
    .select()
    .single();

  if (error) throw new Error(`Failed to finalize repair run: ${error.message}`);
  return data as RepairRun;
}

export async function failRepairRun(repairRunId: string, reason?: string): Promise<RepairRun> {
  const { data: run, error: runErr } = await (supabase as any)
    .from('repair_runs')
    .select('*')
    .eq('id', repairRunId)
    .single();

  if (runErr || !run) throw new CompetitionInvariantError(`Repair run ${repairRunId} not found`);
  if (!['pending', 'running'].includes(run.status)) {
    throw new CompetitionInvariantError(`Cannot fail repair run ${repairRunId} (status: ${run.status})`);
  }

  const { data, error } = await (supabase as any)
    .from('repair_runs')
    .update({ status: 'failed' })
    .eq('id', repairRunId)
    .select()
    .single();

  if (error) throw new Error(`Failed to fail repair run: ${error.message}`);
  return data as RepairRun;
}

export async function cancelRepairRun(repairRunId: string): Promise<RepairRun> {
  const { data: run, error: runErr } = await (supabase as any)
    .from('repair_runs')
    .select('*')
    .eq('id', repairRunId)
    .single();

  if (runErr || !run) throw new CompetitionInvariantError(`Repair run ${repairRunId} not found`);
  if (!['pending', 'running'].includes(run.status)) {
    throw new CompetitionInvariantError(`Cannot cancel repair run ${repairRunId} (status: ${run.status})`);
  }

  const { data, error } = await (supabase as any)
    .from('repair_runs')
    .update({ status: 'cancelled' })
    .eq('id', repairRunId)
    .select()
    .single();

  if (error) throw new Error(`Failed to cancel repair run: ${error.message}`);
  return data as RepairRun;
}

// ── Convenience: check if repair is allowed ──

export async function canRepair(groupId: string, maxAttempts?: number): Promise<{
  allowed: boolean;
  attemptCount: number;
  maxAttempts: number;
  reason?: string;
}> {
  const max = maxAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  
  // Check group status
  const { data: group } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', groupId)
    .single();

  if (!group) return { allowed: false, attemptCount: 0, maxAttempts: max, reason: 'group_not_found' };
  if (group.status === 'closed') return { allowed: false, attemptCount: 0, maxAttempts: max, reason: 'group_closed' };

  const count = await countRepairAttempts(groupId);
  if (count >= max) {
    return { allowed: false, attemptCount: count, maxAttempts: max, reason: 'retry_cap_reached' };
  }

  return { allowed: true, attemptCount: count, maxAttempts: max };
}
