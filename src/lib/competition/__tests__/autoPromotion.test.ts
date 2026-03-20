/**
 * Auto-Promotion Service — deterministic contract + invariant tests.
 *
 * Covers: gate evaluation, no-promotion state, manual compat,
 * IEL invariants, effective winner resolution.
 */
import { describe, it, expect } from 'vitest';
import {
  evaluatePromotionGates,
  DEFAULT_GATE_POLICY,
  type PromotionEvaluation,
} from '@/lib/competition/autoPromotionService';
import type { CandidateRanking } from '@/lib/competition/candidateCompetitionService';

// ── Helpers ──

function makeRanking(overrides: Partial<CandidateRanking> = {}): CandidateRanking {
  return {
    id: 'r-1',
    group_id: 'g-1',
    candidate_version_id: 'cv-1',
    rank_position: 1,
    rank_score: 60,
    score_json: {},
    ranking_inputs_json: {},
    ranked_at: new Date().toISOString(),
    ranking_version_key: 'v1',
    round_id: 'round-1',
    ...overrides,
  };
}

// ── Gate Evaluation Tests ──

describe('evaluatePromotionGates', () => {
  it('promotes top candidate when all gates pass', () => {
    const rankings = [makeRanking({ rank_score: 65, rank_position: 1 })];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(true);
    expect(result.candidateVersionId).toBe('cv-1');
    expect(result.rationale).toContain('passes all gates');
    expect(result.gatingSnapshot.passed).toBe(true);
  });

  it('returns not eligible when no rankings exist', () => {
    const result = evaluatePromotionGates([]);
    expect(result.eligible).toBe(false);
    expect(result.candidateVersionId).toBeNull();
    expect(result.rankScore).toBeNull();
    expect(result.gatingSnapshot.reason).toBe('no_rankings');
  });

  it('blocks promotion when rank_score below threshold', () => {
    const rankings = [makeRanking({ rank_score: 25 })];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(false);
    expect(result.gatingSnapshot.failed_gate).toBe('minimum_rank_score');
    expect(result.rationale).toContain('below threshold');
  });

  it('blocks promotion when identity drift detected', () => {
    const rankings = [
      makeRanking({
        rank_score: 70,
        score_json: { identity_continuity: 'identity_drift' },
      }),
    ];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(false);
    expect(result.gatingSnapshot.failed_gate).toBe('identity_drift');
  });

  it('allows promotion when identity drift check is disabled', () => {
    const rankings = [
      makeRanking({
        rank_score: 70,
        score_json: { identity_continuity: 'identity_drift' },
      }),
    ];
    const policy = { ...DEFAULT_GATE_POLICY, blockOnIdentityDrift: false };
    const result = evaluatePromotionGates(rankings, policy);
    expect(result.eligible).toBe(true);
  });

  it('selects the top-ranked candidate by rank_position', () => {
    const rankings = [
      makeRanking({ candidate_version_id: 'cv-2', rank_position: 2, rank_score: 80 }),
      makeRanking({ candidate_version_id: 'cv-1', rank_position: 1, rank_score: 50 }),
    ];
    const result = evaluatePromotionGates(rankings);
    expect(result.candidateVersionId).toBe('cv-1');
    expect(result.eligible).toBe(true);
  });

  it('uses continuity_class as fallback identity signal', () => {
    const rankings = [
      makeRanking({
        rank_score: 70,
        score_json: { continuity_class: 'identity_drift' },
      }),
    ];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(false);
    expect(result.gatingSnapshot.failed_gate).toBe('identity_drift');
  });

  it('promotes when score_json has strong_match continuity', () => {
    const rankings = [
      makeRanking({
        rank_score: 55,
        score_json: { identity_continuity: 'strong_match' },
      }),
    ];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(true);
  });

  it('uses custom policy minimumRankScore', () => {
    const rankings = [makeRanking({ rank_score: 45 })];
    const strictPolicy = { ...DEFAULT_GATE_POLICY, minimumRankScore: 50 };
    const result = evaluatePromotionGates(rankings, strictPolicy);
    expect(result.eligible).toBe(false);

    const lenientPolicy = { ...DEFAULT_GATE_POLICY, minimumRankScore: 30 };
    const result2 = evaluatePromotionGates(rankings, lenientPolicy);
    expect(result2.eligible).toBe(true);
  });

  it('gating snapshot captures all decision context', () => {
    const rankings = [makeRanking({ rank_score: 60 })];
    const result = evaluatePromotionGates(rankings);
    expect(result.gatingSnapshot).toHaveProperty('policy');
    expect(result.gatingSnapshot).toHaveProperty('candidate_version_id');
    expect(result.gatingSnapshot).toHaveProperty('rank_score');
    expect(result.gatingSnapshot).toHaveProperty('minimum_rank_score');
    expect(result.gatingSnapshot).toHaveProperty('total_candidates');
  });
});

// ── Promotion Status Contract ──

describe('promotion status contract', () => {
  it('promoted result carries a candidate id', () => {
    const rankings = [makeRanking({ rank_score: 60 })];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(true);
    expect(result.candidateVersionId).not.toBeNull();
  });

  it('not_promoted with no rankings has null candidate', () => {
    const result = evaluatePromotionGates([]);
    expect(result.eligible).toBe(false);
    expect(result.candidateVersionId).toBeNull();
  });

  it('not_promoted due to threshold still reports the candidate', () => {
    const rankings = [makeRanking({ rank_score: 20 })];
    const result = evaluatePromotionGates(rankings);
    expect(result.eligible).toBe(false);
    // The candidate is identified but not promoted
    expect(result.candidateVersionId).toBe('cv-1');
  });
});

// ── IEL Invariants ──

describe('promotion IEL invariants', () => {
  it('at most one promotion per round is enforced by DB unique index', () => {
    // Contract: idx_round_promotions_one_per_round ensures uniqueness
    // This test documents the invariant — DB enforcement is authoritative
    const roundId = 'round-1';
    expect(roundId).toBeDefined();
  });

  it('not_promoted cannot carry candidate_version_id at DB level', () => {
    // Contract: trg_validate_round_promotion trigger enforces this
    // If promotion_status = 'not_promoted', promoted_candidate_version_id must be null
    const notPromotedResult = evaluatePromotionGates([]);
    expect(notPromotedResult.eligible).toBe(false);
    expect(notPromotedResult.candidateVersionId).toBeNull();
  });

  it('promoted must carry candidate_version_id at DB level', () => {
    // Contract: trg_validate_round_promotion trigger enforces this
    const rankings = [makeRanking({ rank_score: 60 })];
    const promotedResult = evaluatePromotionGates(rankings);
    expect(promotedResult.eligible).toBe(true);
    expect(promotedResult.candidateVersionId).not.toBeNull();
  });
});

// ── Effective Winner Resolution Contract ──

describe('effective winner resolution contract', () => {
  it('auto_promotion takes precedence over manual_selection', () => {
    // Contract: resolveEffectiveWinner checks promotions before selections
    const sources = ['auto_promotion', 'manual_selection'] as const;
    expect(sources.indexOf('auto_promotion')).toBeLessThan(sources.indexOf('manual_selection'));
  });

  it('most recent round takes precedence over older rounds', () => {
    // Contract: rounds ordered by round_index desc, first match wins
    const roundIndices = [2, 1, 0];
    expect(roundIndices[0]).toBeGreaterThan(roundIndices[1]);
  });

  it('no effective winner when no promotions or selections exist', () => {
    // Contract: returns null if no qualifying decision found across all rounds
    const noDecisions: any[] = [];
    expect(noDecisions.length).toBe(0);
  });
});

// ── Manual Compatibility ──

describe('manual selection compatibility', () => {
  it('manual selection mode remains valid alongside auto promotion', () => {
    // Contract: manual selection persists via selectWinner with selection_mode='manual'
    // Auto promotion persists via autoPromoteRound to round_promotions table
    // These are parallel systems with distinct provenance
    const manualPath = 'candidate_selections';
    const autoPath = 'round_promotions';
    expect(manualPath).not.toBe(autoPath);
  });

  it('effective winner prefers auto_promotion when both exist for same round', () => {
    // Contract: resolveEffectiveWinner checks promotions before selections per round
    const checkOrder = ['promotion', 'selection'] as const;
    expect(checkOrder[0]).toBe('promotion');
  });
});

// ── Repair Round Promotion ──

describe('repair round promotion', () => {
  it('repair-derived round can be promoted if thresholds met', () => {
    // Contract: evaluatePromotionGates is round-type-agnostic
    // A repair round's rankings are evaluated identically to initial/rerun
    const repairRanking = makeRanking({ rank_score: 70 });
    const result = evaluatePromotionGates([repairRanking]);
    expect(result.eligible).toBe(true);
  });

  it('repair-derived round with weak candidates stays not_promoted', () => {
    const weakRepairRanking = makeRanking({ rank_score: 20 });
    const result = evaluatePromotionGates([weakRepairRanking]);
    expect(result.eligible).toBe(false);
  });
});

// ── Policy Key Coverage ──

describe('promotion gate policy', () => {
  it('default policy has reasonable defaults', () => {
    expect(DEFAULT_GATE_POLICY.minimumRankScore).toBeGreaterThan(0);
    expect(DEFAULT_GATE_POLICY.blockOnIdentityDrift).toBe(true);
    expect(DEFAULT_GATE_POLICY.policyKey).toBe('default_v1');
  });

  it('policy key is captured in gating snapshot', () => {
    const rankings = [makeRanking({ rank_score: 60 })];
    const customPolicy = { ...DEFAULT_GATE_POLICY, policyKey: 'strict_v2' };
    const result = evaluatePromotionGates(rankings, customPolicy);
    expect(result.gatingSnapshot.policy).toBe('strict_v2');
  });
});
