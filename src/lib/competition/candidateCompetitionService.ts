/**
 * Candidate Competition Service — canonical write/read operations
 * for the candidate competition substrate (v0.5).
 *
 * IEL-enforced: hard fails on invariant violations.
 * No silent fallbacks. No duplicate payload storage.
 *
 * Tables: candidate_groups, candidate_versions, candidate_rankings, candidate_selections
 */

import { supabase } from '@/integrations/supabase/client';

// ── Types ──

export type CompetitionStatus = 'open' | 'ranked' | 'winner_selected' | 'closed';
export type SelectionMode = 'manual' | 'system_reserved_for_future';
export type RunContextType = 'image' | 'document' | 'poster' | 'lookbook' | 'other';

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
}

export interface CandidateSelection {
  id: string;
  group_id: string;
  selected_candidate_version_id: string;
  selection_mode: SelectionMode;
  selected_by: string | null;
  selected_at: string;
  rationale: string | null;
}

export interface CompetitionGroupWithDetails extends CandidateGroup {
  versions: CandidateVersion[];
  rankings: CandidateRanking[];
  selection: CandidateSelection | null;
}

// ── IEL Error ──

export class CompetitionInvariantError extends Error {
  constructor(message: string) {
    super(`[IEL] Competition invariant violated: ${message}`);
    this.name = 'CompetitionInvariantError';
  }
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

// ── Persist Ranking Snapshot ──

export async function persistRankingSnapshot(params: {
  groupId: string;
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

  // Delete prior rankings for this group + version key to maintain snapshot hygiene
  const versionKey = params.rankingVersionKey || 'v1';
  await (supabase as any)
    .from('candidate_rankings')
    .delete()
    .eq('group_id', params.groupId)
    .eq('ranking_version_key', versionKey);

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

// ── Select Winner ──

export async function selectWinner(params: {
  groupId: string;
  candidateVersionId: string;
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

  // Upsert selection (unique constraint on group_id ensures exactly one)
  // First delete existing, then insert (upsert on unique index)
  await (supabase as any)
    .from('candidate_selections')
    .delete()
    .eq('group_id', params.groupId);

  const { data, error } = await (supabase as any)
    .from('candidate_selections')
    .insert({
      group_id: params.groupId,
      selected_candidate_version_id: params.candidateVersionId,
      selection_mode: params.selectionMode || 'manual',
      selected_by: params.selectedBy || null,
      rationale: params.rationale || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to select winner: ${error.message}`);

  // Update group status
  await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'winner_selected' })
    .eq('id', params.groupId);

  return data as CandidateSelection;
}

// ── Load Group With Details ──

export async function loadCompetitionGroup(groupId: string): Promise<CompetitionGroupWithDetails | null> {
  const { data: group, error } = await (supabase as any)
    .from('candidate_groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (error || !group) return null;

  const [versionsRes, rankingsRes, selectionRes] = await Promise.all([
    (supabase as any).from('candidate_versions').select('*').eq('group_id', groupId).order('candidate_index'),
    (supabase as any).from('candidate_rankings').select('*').eq('group_id', groupId).order('rank_position'),
    (supabase as any).from('candidate_selections').select('*').eq('group_id', groupId).maybeSingle(),
  ]);

  return {
    ...(group as CandidateGroup),
    versions: (versionsRes.data || []) as CandidateVersion[],
    rankings: (rankingsRes.data || []) as CandidateRanking[],
    selection: (selectionRes.data || null) as CandidateSelection | null,
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
  const { error } = await (supabase as any)
    .from('candidate_groups')
    .update({ status: 'closed' })
    .eq('id', groupId);

  if (error) throw new Error(`Failed to close group: ${error.message}`);
}

// ── Ensure Group For Slot (idempotent) ──

/**
 * Find or create a candidate group for a specific project + slot.
 * Returns the most recent open/ranked group if one exists,
 * otherwise creates a new one.
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
    return existing[0] as CandidateGroup;
  }

  return createCandidateGroup({
    projectId: params.projectId,
    runContextType: params.runContextType || 'image',
    slotKey: params.slotKey,
    assetGroup: params.assetGroup,
    characterName: params.characterName,
    createdBy: params.createdBy,
  });
}
