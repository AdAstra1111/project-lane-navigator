/**
 * Candidate Competition Service — canonical write/read operations
 * for the candidate competition substrate (v0.5 + round semantics).
 *
 * IEL-enforced: hard fails on invariant violations.
 * No silent fallbacks. No duplicate payload storage.
 *
 * Tables: candidate_groups, candidate_versions, candidate_rankings,
 *         candidate_selections, competition_rounds
 *
 * ROUND MODEL:
 * - A candidate_group is the stable container for one generation objective/slot.
 * - A competition_round is one discrete competition pass within that group.
 * - Rankings and selections belong to a specific round.
 * - Exactly one round per group may be active at a time (enforced by DB partial unique index).
 * - A rerun for the same slot creates a new round inside the same group.
 * - Prior rounds become 'superseded' and remain immutable/auditable.
 *
 * OBJECTIVE IDENTITY RULES:
 * Same group when: project_id + slot_key + run_context_type match an existing non-closed group.
 * New group when: slot_key differs, or no existing non-closed group matches.
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ──

export type CompetitionStatus = 'open' | 'ranked' | 'winner_selected' | 'closed';
export type SelectionMode = 'manual' | 'system_reserved_for_future';
export type RunContextType = 'image' | 'document' | 'poster' | 'lookbook' | 'other';
export type RoundType = 'initial' | 'rerun' | 'manual_reassessment' | 'repair';
export type RoundStatus = 'active' | 'completed' | 'superseded' | 'failed';

export interface CandidateGroup {
  id: string;
  project_id: string;
  run_context_type: RunContextType;
  run_context_id: string | null;
  slot_key: string | null;
  lane: string | null;
  asset_group: string | null;
  character_name: string | null;
  created_from_task_type: string | null;
  status: CompetitionStatus;
  ranking_policy_key: string;
  created_at: string;
  created_by: string | null;
}

export interface CompetitionRound {
  id: string;
  group_id: string;
  round_index: number;
  round_type: RoundType;
  status: RoundStatus;
  source_round_id: string | null;
  created_at: string;
  created_by: string | null;
}

export interface CandidateVersion {
  id: string;
  group_id: string;
  version_ref_type: string;
  version_ref_id: string;
  candidate_index: number;
  source_run_id: string | null;
  created_at: string;
}

export interface CandidateRanking {
  id: string;
  group_id: string;
  candidate_version_id: string;
  rank_position: number;
  rank_score: number;
  score_json: Record<string, unknown>;
  ranking_inputs_json: Record<string, unknown>;
  ranked_at: string;
  ranking_version_key: string;
  round_id: string | null;
}

export interface CandidateSelection {
  id: string;
  group_id: string;
  selected_candidate_version_id: string;
  selection_mode: SelectionMode;
  selected_by: string | null;
  selected_at: string;
  rationale: string | null;
  round_id: string | null;
}

export interface CompetitionGroupWithDetails extends CandidateGroup {
  versions: CandidateVersion[];
  rankings: CandidateRanking[];
  selection: CandidateSelection | null;
  currentRound: CompetitionRound | null;
  rounds: CompetitionRound[];
}

// ── IEL Error ──

export class CompetitionInvariantError extends Error {
  constructor(message: string) {
    super(`[IEL] Competition invariant violated: ${message}`);
    this.name = 'CompetitionInvariantError';
  }
}

// ── Round Operations ──

/**
 * Create the initial round for a group. Idempotent: returns existing active round if one exists.
 */
export async function createInitialRound(params: {
  groupId: string;
  createdBy?: string;
}): Promise<CompetitionRound> {
  // Check for existing active round
  const { data: existing } = await (supabase as any)
    .from('competition_rounds')
    .select('*')
    .eq('group_id', params.groupId)
    .eq('status', 'active')
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0] as CompetitionRound;
  }

  // Get next round_index
  const { data: maxRound } = await (supabase as any)
    .from('competition_rounds')
    .select('round_index')
    .eq('group_id', params.groupId)
    .order('round_index', { ascending: false })
    .limit(1);

  const nextIndex = (maxRound && maxRound.length > 0) ? maxRound[0].round_index + 1 : 0;

  const { data, error } = await (supabase as any)
    .from('competition_rounds')
    .insert({
      group_id: params.groupId,
      round_index: nextIndex,
      round_type: 'initial',
      status: 'active',
      created_by: params.createdBy || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create initial round: ${error.message}`);
  return data as CompetitionRound;
}

/**
 * Create a rerun round for a group. Supersedes the current active round.
 */
export async function createRerunRound(params: {
  groupId: string;
  roundType?: RoundType;
  createdBy?: string;
}): Promise<CompetitionRound> {
  // IEL: group must exist and not be closed
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) throw new CompetitionInvariantError(`Group ${params.groupId} not found`);
  if (group.status === 'closed') {
    throw new CompetitionInvariantError(`Cannot create rerun round for closed group ${params.groupId}`);
  }

  // Find and supersede current active round
  const { data: activeRounds } = await (supabase as any)
    .from('competition_rounds')
    .select('*')
    .eq('group_id', params.groupId)
    .eq('status', 'active');

  const sourceRoundId = (activeRounds && activeRounds.length > 0) ? activeRounds[0].id : null;

  // Supersede all active rounds for this group
  if (activeRounds && activeRounds.length > 0) {
    await (supabase as any)
      .from('competition_rounds')
      .update({ status: 'superseded' })
      .eq('group_id', params.groupId)
      .eq('status', 'active');
  }

  // Get next round_index
  const { data: maxRound } = await (supabase as any)
    .from('competition_rounds')
    .select('round_index')
    .eq('group_id', params.groupId)
    .order('round_index', { ascending: false })
    .limit(1);

  const nextIndex = (maxRound && maxRound.length > 0) ? maxRound[0].round_index + 1 : 0;

  // Reset group status to open for new round
  await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'open' })
    .eq('id', params.groupId);

  const { data, error } = await (supabase as any)
    .from('competition_rounds')
    .insert({
      group_id: params.groupId,
      round_index: nextIndex,
      round_type: params.roundType || 'rerun',
      status: 'active',
      source_round_id: sourceRoundId,
      created_by: params.createdBy || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create rerun round: ${error.message}`);
  return data as CompetitionRound;
}

/**
 * Load the current active round for a group.
 */
export async function loadCurrentRound(groupId: string): Promise<CompetitionRound | null> {
  const { data, error } = await (supabase as any)
    .from('competition_rounds')
    .select('*')
    .eq('group_id', groupId)
    .eq('status', 'active')
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as CompetitionRound;
}

/**
 * Load full round history for a group, ordered by round_index.
 */
export async function loadRoundHistory(groupId: string): Promise<CompetitionRound[]> {
  const { data, error } = await (supabase as any)
    .from('competition_rounds')
    .select('*')
    .eq('group_id', groupId)
    .order('round_index', { ascending: true });

  if (error) return [];
  return (data || []) as CompetitionRound[];
}

// ── Create Group ──

export async function createCandidateGroup(params: {
  projectId: string;
  runContextType: RunContextType;
  runContextId?: string;
  slotKey?: string;
  lane?: string;
  assetGroup?: string;
  characterName?: string;
  createdFromTaskType?: string;
  rankingPolicyKey?: string;
  createdBy?: string;
}): Promise<CandidateGroup> {
  const { data, error } = await (supabase as any)
    .from('candidate_groups')
    .insert({
      project_id: params.projectId,
      run_context_type: params.runContextType,
      run_context_id: params.runContextId || null,
      slot_key: params.slotKey || null,
      lane: params.lane || null,
      asset_group: params.assetGroup || null,
      character_name: params.characterName || null,
      created_from_task_type: params.createdFromTaskType || null,
      ranking_policy_key: params.rankingPolicyKey || 'default',
      status: 'open',
      created_by: params.createdBy || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create candidate group: ${error.message}`);
  return data as CandidateGroup;
}

// ── Add Candidate Version ──

export async function addCandidateVersion(params: {
  groupId: string;
  versionRefType?: string;
  versionRefId: string;
  candidateIndex?: number;
  sourceRunId?: string;
}): Promise<CandidateVersion> {
  // IEL: verify group exists and is open
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) throw new CompetitionInvariantError(`Group ${params.groupId} not found`);
  if (group.status === 'closed') {
    throw new CompetitionInvariantError(`Cannot add candidate to closed group ${params.groupId}`);
  }

  const { data, error } = await (supabase as any)
    .from('candidate_versions')
    .insert({
      group_id: params.groupId,
      version_ref_type: params.versionRefType || 'project_image',
      version_ref_id: params.versionRefId,
      candidate_index: params.candidateIndex ?? 0,
      source_run_id: params.sourceRunId || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to add candidate version: ${error.message}`);
  return data as CandidateVersion;
}

// ── Persist Ranking Snapshot (round-aware) ──

export async function persistRankingSnapshot(params: {
  groupId: string;
  roundId?: string;
  rankings: Array<{
    candidateVersionId: string;
    rankPosition: number;
    rankScore: number;
    scoreJson?: Record<string, unknown>;
    rankingInputsJson?: Record<string, unknown>;
  }>;
  rankingVersionKey?: string;
}): Promise<CandidateRanking[]> {
  if (params.rankings.length === 0) {
    throw new CompetitionInvariantError('Cannot persist empty ranking snapshot');
  }

  // Resolve round_id: use provided, or find active round, or null for backward compat
  let roundId = params.roundId || null;
  if (!roundId) {
    const currentRound = await loadCurrentRound(params.groupId);
    roundId = currentRound?.id || null;
  }

  // IEL: if round_id provided, verify it belongs to this group and is active
  if (roundId) {
    const { data: round, error: rErr } = await (supabase as any)
      .from('competition_rounds')
      .select('id, group_id, status')
      .eq('id', roundId)
      .single();

    if (rErr || !round) throw new CompetitionInvariantError(`Round ${roundId} not found`);
    if (round.group_id !== params.groupId) {
      throw new CompetitionInvariantError(`Round ${roundId} does not belong to group ${params.groupId}`);
    }
    if (round.status !== 'active') {
      throw new CompetitionInvariantError(`Round ${roundId} is not active (status: ${round.status})`);
    }
  }

  // IEL: verify all candidate_version_ids belong to this group
  const { data: versions, error: vErr } = await (supabase as any)
    .from('candidate_versions')
    .select('id')
    .eq('group_id', params.groupId);

  if (vErr) throw new Error(`Failed to verify candidate versions: ${vErr.message}`);

  const validIds = new Set((versions || []).map((v: any) => v.id));
  for (const r of params.rankings) {
    if (!validIds.has(r.candidateVersionId)) {
      throw new CompetitionInvariantError(
        `Candidate version ${r.candidateVersionId} does not belong to group ${params.groupId}`
      );
    }
  }

  // Delete prior rankings for this group + version key + round to maintain snapshot hygiene
  const versionKey = params.rankingVersionKey || 'v1';
  const deleteQuery = (supabase as any)
    .from('candidate_rankings')
    .delete()
    .eq('group_id', params.groupId)
    .eq('ranking_version_key', versionKey);

  if (roundId) {
    deleteQuery.eq('round_id', roundId);
  } else {
    deleteQuery.is('round_id', null);
  }
  await deleteQuery;

  const now = new Date().toISOString();
  const rows = params.rankings.map(r => ({
    group_id: params.groupId,
    candidate_version_id: r.candidateVersionId,
    rank_position: r.rankPosition,
    rank_score: r.rankScore,
    score_json: r.scoreJson || {},
    ranking_inputs_json: r.rankingInputsJson || {},
    ranked_at: now,
    ranking_version_key: versionKey,
    round_id: roundId,
  }));

  const { data, error } = await (supabase as any)
    .from('candidate_rankings')
    .insert(rows)
    .select();

  if (error) throw new Error(`Failed to persist ranking snapshot: ${error.message}`);

  // Update group status to 'ranked'
  await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'ranked' })
    .eq('id', params.groupId)
    .in('status', ['open', 'ranked']);

  return (data || []) as CandidateRanking[];
}

// ── Select Winner (round-aware, history-preserving) ──

export async function selectWinner(params: {
  groupId: string;
  candidateVersionId: string;
  roundId?: string;
  selectionMode?: SelectionMode;
  selectedBy?: string;
  rationale?: string;
}): Promise<CandidateSelection> {
  // IEL: verify group exists
  const { data: group, error: gErr } = await (supabase as any)
    .from('candidate_groups')
    .select('id, status')
    .eq('id', params.groupId)
    .single();

  if (gErr || !group) throw new CompetitionInvariantError(`Group ${params.groupId} not found`);

  // IEL: verify candidate belongs to group
  const { data: cv, error: cvErr } = await (supabase as any)
    .from('candidate_versions')
    .select('id')
    .eq('id', params.candidateVersionId)
    .eq('group_id', params.groupId)
    .single();

  if (cvErr || !cv) {
    throw new CompetitionInvariantError(
      `Candidate version ${params.candidateVersionId} does not belong to group ${params.groupId}`
    );
  }

  // IEL: group must have at least one candidate
  const { count, error: cntErr } = await (supabase as any)
    .from('candidate_versions')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', params.groupId);

  if (cntErr || (count ?? 0) === 0) {
    throw new CompetitionInvariantError(`Group ${params.groupId} has no candidates`);
  }

  // Resolve round_id
  let roundId = params.roundId || null;
  if (!roundId) {
    const currentRound = await loadCurrentRound(params.groupId);
    roundId = currentRound?.id || null;
  }

  // IEL: if round_id provided, verify it belongs to this group
  if (roundId) {
    const { data: round, error: rErr } = await (supabase as any)
      .from('competition_rounds')
      .select('id, group_id, status')
      .eq('id', roundId)
      .single();

    if (rErr || !round) throw new CompetitionInvariantError(`Round ${roundId} not found`);
    if (round.group_id !== params.groupId) {
      throw new CompetitionInvariantError(`Round ${roundId} does not belong to group ${params.groupId}`);
    }
  }

  // Delete existing selection for THIS round only (preserves prior round selections in history)
  const deleteQuery = (supabase as any)
    .from('candidate_selections')
    .delete()
    .eq('group_id', params.groupId);

  if (roundId) {
    deleteQuery.eq('round_id', roundId);
  } else {
    deleteQuery.is('round_id', null);
  }
  await deleteQuery;

  const { data, error } = await (supabase as any)
    .from('candidate_selections')
    .insert({
      group_id: params.groupId,
      selected_candidate_version_id: params.candidateVersionId,
      selection_mode: params.selectionMode || 'manual',
      selected_by: params.selectedBy || null,
      rationale: params.rationale || null,
      round_id: roundId,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to select winner: ${error.message}`);

  // Update group status
  await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'winner_selected' })
    .eq('id', params.groupId);

  // Mark round as completed if round-aware
  if (roundId) {
    await (supabase as any)
      .from('competition_rounds')
      .update({ status: 'completed' })
      .eq('id', roundId);
  }

  return data as CandidateSelection;
}

// ── Load Group With Details (round-aware) ──

export async function loadCompetitionGroup(groupId: string): Promise<CompetitionGroupWithDetails | null> {
  const { data: group, error } = await (supabase as any)
    .from('candidate_groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (error || !group) return null;

  const [versionsRes, rankingsRes, selectionsRes, roundsRes] = await Promise.all([
    (supabase as any).from('candidate_versions').select('*').eq('group_id', groupId).order('candidate_index'),
    (supabase as any).from('candidate_rankings').select('*').eq('group_id', groupId).order('rank_position'),
    (supabase as any).from('candidate_selections').select('*').eq('group_id', groupId).order('selected_at', { ascending: false }),
    (supabase as any).from('competition_rounds').select('*').eq('group_id', groupId).order('round_index', { ascending: true }),
  ]);

  const rounds = (roundsRes.data || []) as CompetitionRound[];
  const currentRound = rounds.find(r => r.status === 'active') || rounds[rounds.length - 1] || null;

  // Current effective selection: from the most recent round that has one,
  // or the latest selection overall for backward compat
  const allSelections = (selectionsRes.data || []) as CandidateSelection[];
  let effectiveSelection: CandidateSelection | null = null;

  if (currentRound) {
    // Prefer selection from current/latest round
    effectiveSelection = allSelections.find(s => s.round_id === currentRound.id) || null;
  }
  if (!effectiveSelection && allSelections.length > 0) {
    effectiveSelection = allSelections[0]; // fallback: most recent by selected_at
  }

  return {
    ...(group as CandidateGroup),
    versions: (versionsRes.data || []) as CandidateVersion[],
    rankings: (rankingsRes.data || []) as CandidateRanking[],
    selection: effectiveSelection,
    currentRound,
    rounds,
  };
}

// ── Load Groups For Project Slot ──

export async function loadGroupsForSlot(
  projectId: string,
  slotKey: string,
): Promise<CandidateGroup[]> {
  const { data, error } = await (supabase as any)
    .from('candidate_groups')
    .select('*')
    .eq('project_id', projectId)
    .eq('slot_key', slotKey)
    .order('created_at', { ascending: false });

  if (error) return [];
  return (data || []) as CandidateGroup[];
}

// ── Load Active Groups For Project ──

export async function loadActiveGroups(projectId: string): Promise<CandidateGroup[]> {
  const { data, error } = await (supabase as any)
    .from('candidate_groups')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['open', 'ranked', 'winner_selected'])
    .order('created_at', { ascending: false });

  if (error) return [];
  return (data || []) as CandidateGroup[];
}

// ── Close Group ──

export async function closeGroup(groupId: string): Promise<void> {
  // Also close any active rounds
  await (supabase as any)
    .from('competition_rounds')
    .update({ status: 'completed' })
    .eq('group_id', groupId)
    .eq('status', 'active');

  const { error } = await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'closed' })
    .eq('id', groupId);

  if (error) throw new Error(`Failed to close group: ${error.message}`);
}

// ── Ensure Group For Slot (idempotent, now creates initial round) ──

/**
 * Find or create a candidate group for a specific project + slot.
 * Returns the most recent open/ranked group if one exists,
 * otherwise creates a new one with an initial round.
 *
 * OBJECTIVE IDENTITY RULE:
 * Same group when: project_id + slot_key match an existing non-closed group.
 * New group when: no existing non-closed group matches for this slot_key.
 */
export async function ensureGroupForSlot(params: {
  projectId: string;
  slotKey: string;
  runContextType?: RunContextType;
  assetGroup?: string;
  characterName?: string;
  createdBy?: string;
}): Promise<CandidateGroup> {
  // Look for existing open group for this slot
  const { data: existing } = await (supabase as any)
    .from('candidate_groups')
    .select('*')
    .eq('project_id', params.projectId)
    .eq('slot_key', params.slotKey)
    .in('status', ['open', 'ranked'])
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    // Ensure it has a round
    await createInitialRound({ groupId: existing[0].id, createdBy: params.createdBy });
    return existing[0] as CandidateGroup;
  }

  const group = await createCandidateGroup({
    projectId: params.projectId,
    runContextType: params.runContextType || 'image',
    slotKey: params.slotKey,
    assetGroup: params.assetGroup,
    characterName: params.characterName,
    createdBy: params.createdBy,
  });

  // Create initial round for new group
  await createInitialRound({ groupId: group.id, createdBy: params.createdBy });

  return group;
}
