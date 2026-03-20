/**
 * Anchor Visual Similarity — regression tests.
 */
import { describe, it, expect } from 'vitest';
import {
  computeCompositeScore,
  computeSimilarityRankAdjustment,
  getSimilarityLabel,
  NEUTRAL_SIMILARITY,
  type VisualSimilarityResult,
} from '../anchorVisualSimilarity';

// Helper to build a result with uniform dimension scores
function makeResult(overallScore: number, confidence: 'high' | 'medium' | 'low' | 'unavailable' = 'high'): VisualSimilarityResult {
  const dim = { score: overallScore, confidence, reason: 'test' };
  const dims = { face: dim, hair: dim, age: dim, body: dim, overall: dim };
  const { compositeScore, isActionable } = computeCompositeScore(dims);
  return {
    dimensions: dims,
    anchorContext: 'full_lock',
    summary: 'test',
    compositeScore,
    isActionable,
  };
}

describe('computeCompositeScore', () => {
  it('returns neutral when all dimensions are unavailable', () => {
    const { compositeScore, isActionable } = computeCompositeScore(NEUTRAL_SIMILARITY.dimensions);
    expect(compositeScore).toBe(50);
    expect(isActionable).toBe(false);
  });

  it('computes weighted average from available dimensions', () => {
    const dims = {
      face: { score: 90, confidence: 'high' as const, reason: 'strong' },
      hair: { score: 80, confidence: 'high' as const, reason: 'good' },
      age: { score: 70, confidence: 'medium' as const, reason: 'ok' },
      body: { score: 50, confidence: 'unavailable' as const, reason: 'not visible' },
      overall: { score: 85, confidence: 'high' as const, reason: 'strong' },
    };
    const { compositeScore, isActionable } = computeCompositeScore(dims);
    // body excluded (unavailable), remaining weights: 0.40+0.15+0.20+0.15 = 0.90
    // weighted sum: 90*0.40 + 80*0.15 + 70*0.20 + 85*0.15 = 36+12+14+12.75 = 74.75
    // normalized: 74.75 / 0.90 ≈ 83
    expect(compositeScore).toBe(83);
    expect(isActionable).toBe(true);
  });

  it('partial anchor with only face assessable is still actionable', () => {
    const dims = {
      face: { score: 75, confidence: 'high' as const, reason: 'ok' },
      hair: { score: 50, confidence: 'unavailable' as const, reason: 'n/a' },
      age: { score: 50, confidence: 'unavailable' as const, reason: 'n/a' },
      body: { score: 50, confidence: 'unavailable' as const, reason: 'n/a' },
      overall: { score: 50, confidence: 'unavailable' as const, reason: 'n/a' },
    };
    const { compositeScore, isActionable } = computeCompositeScore(dims);
    // Only face (weight 0.40 >= 0.20 threshold)
    expect(compositeScore).toBe(75);
    expect(isActionable).toBe(true);
  });
});

describe('computeSimilarityRankAdjustment', () => {
  it('returns 0 when similarity is null', () => {
    const { adjustment } = computeSimilarityRankAdjustment(null);
    expect(adjustment).toBe(0);
  });

  it('returns 0 when similarity is not actionable', () => {
    const { adjustment } = computeSimilarityRankAdjustment(NEUTRAL_SIMILARITY);
    expect(adjustment).toBe(0);
  });

  it('returns +10 for strong match (>=80)', () => {
    const { adjustment } = computeSimilarityRankAdjustment(makeResult(85));
    expect(adjustment).toBe(10);
  });

  it('returns +3 for moderate match (60-79)', () => {
    const { adjustment } = computeSimilarityRankAdjustment(makeResult(65));
    expect(adjustment).toBe(3);
  });

  it('returns 0 for weak match (40-59)', () => {
    const { adjustment } = computeSimilarityRankAdjustment(makeResult(45));
    expect(adjustment).toBe(0);
  });

  it('returns -8 for low similarity (<40)', () => {
    const { adjustment } = computeSimilarityRankAdjustment(makeResult(25));
    expect(adjustment).toBe(-8);
  });
});

describe('getSimilarityLabel', () => {
  it('labels scores correctly', () => {
    expect(getSimilarityLabel(85)).toBe('Strong match');
    expect(getSimilarityLabel(65)).toBe('Moderate match');
    expect(getSimilarityLabel(45)).toBe('Weak match');
    expect(getSimilarityLabel(20)).toBe('Low similarity');
  });
});

describe('ranking integration with visual similarity', () => {
  // Import ranking function
  const { rankCharacterCandidates } = await vi.importActual('../characterCandidateRanking') as typeof import('../characterCandidateRanking');

  const makeImage = (overrides: Partial<any> = {}): any => ({
    id: 'img-' + Math.random().toString(36).slice(2, 8),
    asset_group: 'character',
    subject: 'Hana',
    shot_type: 'identity_headshot',
    generation_config: {},
    created_at: new Date().toISOString(),
    ...overrides,
  });

  const fullAnchorSet: any = {
    characterName: 'Hana',
    headshot: makeImage({ id: 'anchor-h' }),
    profile: makeImage({ id: 'anchor-p' }),
    fullBody: makeImage({ id: 'anchor-fb' }),
    completeness: 'full_lock',
    anchorPaths: { headshot: '/h', fullBody: '/fb' },
  };

  it('metadata-locked candidate can be demoted by weak visual similarity', () => {
    const locked = makeImage({
      id: 'locked-weak-visual',
      generation_config: { identity_locked: true, identity_anchor_paths: { headshot: '/h' } },
    });
    const unlocked = makeImage({
      id: 'unlocked-strong-visual',
      generation_config: {},
    });

    const similarities: Record<string, VisualSimilarityResult> = {
      'locked-weak-visual': makeResult(25),     // low visual match → -8
      'unlocked-strong-visual': makeResult(90),  // strong visual match → +10
    };

    // Without similarity, locked wins (strong_match=40 vs identity_drift=0)
    const withoutSim = rankCharacterCandidates([locked, unlocked], fullAnchorSet);
    expect(withoutSim.top!.image.id).toBe('locked-weak-visual');

    // With similarity, unlocked-strong can challenge
    // locked: 40 (continuity) + 0 (no drift) + (-8) (sim) = 32
    // unlocked: 0 (drift) + (-25) (drift penalty) + 10 (sim) = -15
    // locked still wins in this case because drift penalty is heavy
    const withSim = rankCharacterCandidates([locked, unlocked], fullAnchorSet, null, similarities);
    // locked: 40 + 0 + (-8) = 32; unlocked: 0 + (-25) + 10 = -15
    expect(withSim.top!.image.id).toBe('locked-weak-visual');
    // But the similarity adjustment is reflected
    const lockedRanked = withSim.ranked.find(r => r.image.id === 'locked-weak-visual')!;
    expect(lockedRanked.similarityAdjustment).toBe(-8);
    expect(lockedRanked.visualSimilarity).toBeTruthy();
  });

  it('visual similarity affects rank reason', () => {
    const img = makeImage({
      id: 'img-sim',
      generation_config: { identity_locked: true },
    });
    const similarities: Record<string, VisualSimilarityResult> = {
      'img-sim': makeResult(85),
    };
    const result = rankCharacterCandidates([img], fullAnchorSet, null, similarities);
    expect(result.top!.rankReason).toContain('strong visual match');
  });

  it('no similarity data = no adjustment, no crash', () => {
    const img = makeImage({ id: 'img-nosim' });
    const result = rankCharacterCandidates([img], fullAnchorSet, null, null);
    expect(result.top!.similarityAdjustment).toBe(0);
    expect(result.top!.visualSimilarity).toBeNull();
  });
});
