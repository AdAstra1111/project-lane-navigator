/**
 * Anchor Visual Similarity — regression tests.
 * Covers: composite scoring, rank adjustment, cache key computation,
 * labels, ranking integration, and cache invalidation semantics.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  computeCompositeScore,
  computeSimilarityRankAdjustment,
  computeAnchorHash,
  getSimilarityLabel,
  NEUTRAL_SIMILARITY,
  SCORING_VERSION,
  type VisualSimilarityResult,
} from '../anchorVisualSimilarity';
import type { IdentityAnchorSet } from '../characterIdentityAnchorSet';

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

function makeImage(overrides: Partial<any> = {}): any {
  return {
    id: 'img-' + Math.random().toString(36).slice(2, 8),
    asset_group: 'character',
    subject: 'Hana',
    shot_type: 'identity_headshot',
    generation_config: {},
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const fullAnchorSet: IdentityAnchorSet = {
  characterName: 'Hana',
  headshot: makeImage({ id: 'anchor-h' }),
  profile: makeImage({ id: 'anchor-p' }),
  fullBody: makeImage({ id: 'anchor-fb' }),
  completeness: 'full_lock',
  anchorPaths: { headshot: '/h', fullBody: '/fb' },
};

const partialAnchorSet: IdentityAnchorSet = {
  characterName: 'Hana',
  headshot: makeImage({ id: 'anchor-h2' }),
  profile: null,
  fullBody: null,
  completeness: 'partial_lock',
  anchorPaths: { headshot: '/h2' },
};

const noAnchorSet: IdentityAnchorSet = {
  characterName: 'Hana',
  headshot: null,
  profile: null,
  fullBody: null,
  completeness: 'no_anchors',
  anchorPaths: {},
};

// ── computeAnchorHash ──

describe('computeAnchorHash', () => {
  it('produces deterministic hash for full lock', () => {
    const h1 = computeAnchorHash(fullAnchorSet);
    const h2 = computeAnchorHash(fullAnchorSet);
    expect(h1).toBe(h2);
    expect(h1).toContain('h:anchor-h');
    expect(h1).toContain('p:anchor-p');
    expect(h1).toContain('f:anchor-fb');
  });

  it('returns "none" for no anchors', () => {
    expect(computeAnchorHash(noAnchorSet)).toBe('none');
  });

  it('changes when anchor IDs change', () => {
    const modified: IdentityAnchorSet = {
      ...fullAnchorSet,
      headshot: makeImage({ id: 'different-h' }),
    };
    expect(computeAnchorHash(modified)).not.toBe(computeAnchorHash(fullAnchorSet));
  });

  it('partial lock includes only available anchors', () => {
    const hash = computeAnchorHash(partialAnchorSet);
    expect(hash).toContain('h:anchor-h2');
    expect(hash).not.toContain('p:');
    expect(hash).not.toContain('f:');
  });
});

// ── computeCompositeScore ──

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
    expect(compositeScore).toBe(83);
    expect(isActionable).toBe(true);
  });

  it('weights face highest', () => {
    const high = { score: 90, confidence: 'high' as const, reason: 'test' };
    const low = { score: 30, confidence: 'high' as const, reason: 'test' };
    const faceHigh = computeCompositeScore({ face: high, hair: low, age: low, body: low, overall: low });
    const faceLow = computeCompositeScore({ face: low, hair: high, age: low, body: low, overall: low });
    expect(faceHigh.compositeScore).toBeGreaterThan(faceLow.compositeScore);
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
    expect(compositeScore).toBe(75);
    expect(isActionable).toBe(true);
  });
});

// ── computeSimilarityRankAdjustment ──

describe('computeSimilarityRankAdjustment', () => {
  it('returns 0 when similarity is null', () => {
    expect(computeSimilarityRankAdjustment(null).adjustment).toBe(0);
  });

  it('returns 0 when similarity is not actionable', () => {
    expect(computeSimilarityRankAdjustment(NEUTRAL_SIMILARITY).adjustment).toBe(0);
  });

  it('returns +10 for strong match (>=80)', () => {
    expect(computeSimilarityRankAdjustment(makeResult(85)).adjustment).toBe(10);
  });

  it('returns +3 for moderate match (60-79)', () => {
    expect(computeSimilarityRankAdjustment(makeResult(65)).adjustment).toBe(3);
  });

  it('returns 0 for weak match (40-59)', () => {
    expect(computeSimilarityRankAdjustment(makeResult(45)).adjustment).toBe(0);
  });

  it('returns -8 for low similarity (<40)', () => {
    expect(computeSimilarityRankAdjustment(makeResult(25)).adjustment).toBe(-8);
  });
});

// ── getSimilarityLabel ──

describe('getSimilarityLabel', () => {
  it('labels scores correctly', () => {
    expect(getSimilarityLabel(85)).toBe('Strong match');
    expect(getSimilarityLabel(65)).toBe('Moderate match');
    expect(getSimilarityLabel(45)).toBe('Weak match');
    expect(getSimilarityLabel(20)).toBe('Low similarity');
  });
});

// ── SCORING_VERSION ──

describe('SCORING_VERSION', () => {
  it('exists and is a non-empty string', () => {
    expect(SCORING_VERSION).toBeTruthy();
    expect(typeof SCORING_VERSION).toBe('string');
  });
});

// ── Ranking integration with visual similarity ──

describe('ranking integration with visual similarity', async () => {
  const { rankCharacterCandidates } = await import('../characterCandidateRanking');

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
      'locked-weak-visual': makeResult(25),
      'unlocked-strong-visual': makeResult(90),
    };

    const withSim = rankCharacterCandidates([locked, unlocked], fullAnchorSet, null, null, similarities);
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
    const result = rankCharacterCandidates([img], fullAnchorSet, null, null, similarities);
    expect(result.top!.rankReason).toContain('strong visual match');
  });

  it('no similarity data = no adjustment, no crash', () => {
    const img = makeImage({ id: 'img-nosim' });
    const result = rankCharacterCandidates([img], fullAnchorSet, null, null);
    expect(result.top!.similarityAdjustment).toBe(0);
    expect(result.top!.visualSimilarity).toBeNull();
  });

  // ── Cache invalidation semantics ──

  it('anchor hash changes when anchors change, invalidating cache', () => {
    const hashBefore = computeAnchorHash(fullAnchorSet);
    const newAnchors: IdentityAnchorSet = {
      ...fullAnchorSet,
      headshot: makeImage({ id: 'new-headshot' }),
    };
    const hashAfter = computeAnchorHash(newAnchors);
    expect(hashBefore).not.toBe(hashAfter);
  });
});
