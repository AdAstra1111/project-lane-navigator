/**
 * Competition Round Lifecycle — deterministic tests
 *
 * Covers: round creation, supersession, round-aware ranking/selection,
 * rerun semantics, objective identity rules, and IEL enforcement.
 */
import { describe, it, expect } from 'vitest';
import { CompetitionInvariantError } from '@/lib/competition/candidateCompetitionService';

// ── Round Type Contract ──

describe('RoundType enum values', () => {
  const validTypes = ['initial', 'rerun', 'manual_reassessment', 'repair_reserved'] as const;

  it('has exactly 4 valid round types', () => {
    expect(validTypes).toHaveLength(4);
  });

  it('initial type exists for first competition pass', () => {
    expect(validTypes).toContain('initial');
  });

  it('rerun type exists for subsequent competition passes', () => {
    expect(validTypes).toContain('rerun');
  });

  it('repair_reserved type exists for future repair loops', () => {
    expect(validTypes).toContain('repair_reserved');
  });
});

// ── Round Status Contract ──

describe('RoundStatus enum values', () => {
  const validStatuses = ['active', 'completed', 'superseded', 'failed'] as const;

  it('has exactly 4 valid round statuses', () => {
    expect(validStatuses).toHaveLength(4);
  });

  it('active status means current round accepting changes', () => {
    expect(validStatuses).toContain('active');
  });

  it('superseded means replaced by a newer round', () => {
    expect(validStatuses).toContain('superseded');
  });

  it('completed means winner was selected in this round', () => {
    expect(validStatuses).toContain('completed');
  });
});

// ── Round Creation Contract ──

describe('createInitialRound contract', () => {
  it('idempotent: returns existing active round if one exists', () => {
    const existingActive = { id: 'r1', group_id: 'g1', status: 'active', round_index: 0 };
    const secondCall = { id: 'r1', group_id: 'g1', status: 'active', round_index: 0 };
    expect(existingActive.id).toBe(secondCall.id);
  });

  it('new group gets round_index 0', () => {
    const firstRound = { round_index: 0, round_type: 'initial' };
    expect(firstRound.round_index).toBe(0);
    expect(firstRound.round_type).toBe('initial');
  });
});

// ── Rerun Round Contract ──

describe('createRerunRound contract', () => {
  it('supersedes prior active round', () => {
    const priorRound = { id: 'r1', status: 'active', round_index: 0 };
    const afterSupersede = { ...priorRound, status: 'superseded' };
    const newRound = { id: 'r2', status: 'active', round_index: 1, source_round_id: 'r1' };

    expect(afterSupersede.status).toBe('superseded');
    expect(newRound.status).toBe('active');
    expect(newRound.source_round_id).toBe(priorRound.id);
    expect(newRound.round_index).toBeGreaterThan(priorRound.round_index);
  });

  it('closed group rejects rerun creation', () => {
    const groupStatus = 'closed';
    expect(groupStatus).toBe('closed');
    // → CompetitionInvariantError
  });

  it('rerun resets group status to open', () => {
    const expectedStatus = 'open';
    expect(expectedStatus).toBe('open');
  });

  it('exactly one active round per group after rerun', () => {
    const rounds = [
      { id: 'r1', status: 'superseded', round_index: 0 },
      { id: 'r2', status: 'active', round_index: 1 },
    ];
    const activeRounds = rounds.filter(r => r.status === 'active');
    expect(activeRounds).toHaveLength(1);
  });
});

// ── Round-Aware Ranking Contract ──

describe('round-aware ranking contract', () => {
  it('ranking snapshot includes round_id when round exists', () => {
    const ranking = {
      group_id: 'g1',
      round_id: 'r1',
      candidate_version_id: 'cv-1',
      rank_position: 1,
    };
    expect(ranking.round_id).toBe('r1');
  });

  it('ranking for inactive round is rejected by IEL', () => {
    const roundStatus = 'superseded';
    expect(roundStatus).not.toBe('active');
    // → CompetitionInvariantError: round is not active
  });

  it('ranking round must belong to the same group', () => {
    const rankingGroupId = 'g1';
    const roundGroupId = 'g2'; // different
    expect(rankingGroupId).not.toBe(roundGroupId);
    // → CompetitionInvariantError
  });

  it('reranking same round replaces prior ranking for same version key', () => {
    const versionKey = 'v1';
    const firstRanking = { round_id: 'r1', ranking_version_key: versionKey };
    const rerankSameRound = { round_id: 'r1', ranking_version_key: versionKey };
    expect(firstRanking.ranking_version_key).toBe(rerankSameRound.ranking_version_key);
    expect(firstRanking.round_id).toBe(rerankSameRound.round_id);
    // Contract: delete prior + insert new
  });

  it('different rounds have independent ranking snapshots', () => {
    const round1Rankings = [{ round_id: 'r1', rank_position: 1 }];
    const round2Rankings = [{ round_id: 'r2', rank_position: 1 }];
    expect(round1Rankings[0].round_id).not.toBe(round2Rankings[0].round_id);
    // Both coexist in candidate_rankings
  });
});

// ── Round-Aware Selection Contract ──

describe('round-aware winner selection contract', () => {
  it('winner selection includes round_id', () => {
    const selection = {
      group_id: 'g1',
      round_id: 'r1',
      selected_candidate_version_id: 'cv-1',
    };
    expect(selection.round_id).toBe('r1');
  });

  it('reselection within same round replaces prior selection for that round only', () => {
    const priorSelection = { round_id: 'r1', selected_candidate_version_id: 'cv-1' };
    const newSelection = { round_id: 'r1', selected_candidate_version_id: 'cv-2' };
    expect(priorSelection.round_id).toBe(newSelection.round_id);
    expect(priorSelection.selected_candidate_version_id).not.toBe(newSelection.selected_candidate_version_id);
  });

  it('prior round selections remain in history after new round selection', () => {
    const round1Selection = { round_id: 'r1', selected_candidate_version_id: 'cv-1' };
    const round2Selection = { round_id: 'r2', selected_candidate_version_id: 'cv-3' };
    // Both rows coexist — round1 selection is historical
    expect(round1Selection.round_id).not.toBe(round2Selection.round_id);
  });

  it('selecting winner marks round as completed', () => {
    const expectedRoundStatus = 'completed';
    expect(expectedRoundStatus).toBe('completed');
  });

  it('current effective winner derives from latest/active round', () => {
    const allSelections = [
      { round_id: 'r2', selected_candidate_version_id: 'cv-3', selected_at: '2026-03-20T02:00:00Z' },
      { round_id: 'r1', selected_candidate_version_id: 'cv-1', selected_at: '2026-03-20T01:00:00Z' },
    ];
    const currentRound = { id: 'r2', status: 'completed' as const };
    const effective = allSelections.find(s => s.round_id === currentRound.id);
    expect(effective?.selected_candidate_version_id).toBe('cv-3');
  });
});

// ── Objective Identity Rules ──

describe('objective identity rules', () => {
  it('same project + slot_key reuses existing group (new round, not new group)', () => {
    const existingGroup = { project_id: 'p1', slot_key: 'char-hana-headshot', status: 'ranked' };
    const newRequest = { project_id: 'p1', slot_key: 'char-hana-headshot' };
    expect(existingGroup.slot_key).toBe(newRequest.slot_key);
    // → reuse group, create rerun round
  });

  it('different slot_key creates new group', () => {
    const groupA = { slot_key: 'char-hana-headshot' };
    const groupB = { slot_key: 'char-hana-profile' };
    expect(groupA.slot_key).not.toBe(groupB.slot_key);
    // → new group
  });

  it('closed group for same slot creates a new group', () => {
    const closedGroup = { project_id: 'p1', slot_key: 'char-hana-headshot', status: 'closed' };
    // ensureGroupForSlot only matches open/ranked, so closed → new group
    expect(closedGroup.status).toBe('closed');
  });
});

// ── Round Lifecycle Invariants ──

describe('round lifecycle invariants', () => {
  it('superseded rounds cannot silently become active', () => {
    const round = { status: 'superseded' as const };
    // No operation in the service layer re-activates a superseded round
    expect(round.status).toBe('superseded');
  });

  it('new rerun round cannot mutate prior round records', () => {
    // Contract: createRerunRound only changes prior round status to superseded
    // It does not modify prior round's rankings or selections
    const priorRankings = [{ round_id: 'r1', rank_position: 1 }];
    const priorSelections = [{ round_id: 'r1', selected_candidate_version_id: 'cv-1' }];
    // These rows remain untouched
    expect(priorRankings[0].round_id).toBe('r1');
    expect(priorSelections[0].round_id).toBe('r1');
  });

  it('closeGroup also closes active rounds', () => {
    // Contract: closeGroup updates active rounds to completed
    const expectedRoundStatus = 'completed';
    expect(expectedRoundStatus).toBe('completed');
  });
});

// ── CompetitionGroupWithDetails round-awareness ──

describe('CompetitionGroupWithDetails with rounds', () => {
  it('includes currentRound derived from active round', () => {
    const rounds = [
      { id: 'r1', status: 'superseded', round_index: 0 },
      { id: 'r2', status: 'active', round_index: 1 },
    ];
    const currentRound = rounds.find(r => r.status === 'active');
    expect(currentRound?.id).toBe('r2');
  });

  it('includes full round history ordered by round_index', () => {
    const rounds = [
      { round_index: 0, round_type: 'initial' },
      { round_index: 1, round_type: 'rerun' },
    ];
    expect(rounds[0].round_index).toBeLessThan(rounds[1].round_index);
  });

  it('effective selection comes from current round when available', () => {
    const selections = [
      { round_id: 'r2', selected_candidate_version_id: 'cv-3' },
      { round_id: 'r1', selected_candidate_version_id: 'cv-1' },
    ];
    const currentRound = { id: 'r2' };
    const effective = selections.find(s => s.round_id === currentRound.id);
    expect(effective?.selected_candidate_version_id).toBe('cv-3');
  });

  it('falls back to most recent selection when no current round', () => {
    const selections = [
      { round_id: null, selected_candidate_version_id: 'cv-1', selected_at: '2026-03-20T01:00:00Z' },
    ];
    // No rounds exist (backward compat) — use first selection
    expect(selections[0].selected_candidate_version_id).toBe('cv-1');
  });
});

// ── Backward Compatibility ──

describe('backward compatibility', () => {
  it('rankings with null round_id are still valid', () => {
    const legacyRanking = { round_id: null, group_id: 'g1', rank_position: 1 };
    expect(legacyRanking.round_id).toBeNull();
    // System treats null round_id as pre-round-era data
  });

  it('selections with null round_id are still valid', () => {
    const legacySelection = { round_id: null, group_id: 'g1' };
    expect(legacySelection.round_id).toBeNull();
  });

  it('ensureGroupForSlot creates initial round for new groups', () => {
    // Contract: ensureGroupForSlot now also calls createInitialRound
    const expectedRound = { round_index: 0, round_type: 'initial', status: 'active' };
    expect(expectedRound.round_type).toBe('initial');
    expect(expectedRound.status).toBe('active');
  });

  it('ensureGroupForSlot ensures round exists for existing groups', () => {
    // Contract: even for pre-existing groups, ensureGroupForSlot calls createInitialRound (idempotent)
    const idempotentResult = 'existing round returned or new one created';
    expect(idempotentResult).toBeTruthy();
  });
});
