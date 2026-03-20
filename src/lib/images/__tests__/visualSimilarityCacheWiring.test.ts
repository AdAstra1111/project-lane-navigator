/**
 * Visual Similarity Cache Wiring — regression tests
 * Verifies cached similarities flow into ranking correctly
 * and that cache-miss produces neutral/stable behavior.
 */
import { describe, it, expect } from 'vitest';
import { rankCharacterCandidates } from '@/lib/images/characterCandidateRanking';
import type { ProjectImage } from '@/lib/images/types';
import type { IdentityAnchorSet } from '@/lib/images/characterIdentityAnchorSet';
import type { VisualSimilarityResult } from '@/lib/images/anchorVisualSimilarity';

function makeImage(overrides: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-1',
    project_id: 'p1',
    role: 'character_primary',
    entity_id: null,
    strategy_key: null,
    prompt_used: '',
    negative_prompt: '',
    canon_constraints: {},
    storage_path: '',
    storage_bucket: 'images',
    width: 1024,
    height: 1792,
    is_primary: false,
    is_active: true,
    source_poster_id: null,
    created_at: '2026-01-01T00:00:00Z',
    created_by: null,
    user_id: 'u1',
    provider: 'test',
    model: 'test',
    style_mode: 'cinematic',
    generation_config: {},
    asset_group: 'character',
    subject: 'Hana',
    shot_type: 'identity_headshot',
    curation_state: 'active',
    subject_type: null,
    subject_ref: null,
    generation_purpose: null,
    location_ref: null,
    moment_ref: null,
    state_key: null,
    state_label: null,
    lane_key: null,
    prestige_style: null,
    lane_compliance_score: null,
    ...overrides,
  };
}

function makeResult(overall: number): VisualSimilarityResult {
  const dim = (score: number) => ({ score, confidence: 'high' as const, reason: 'test' });
  return {
    dimensions: { face: dim(overall), hair: dim(overall), age: dim(overall), body: dim(50), overall: dim(overall) },
    anchorContext: 'full_lock',
    summary: 'test',
    compositeScore: overall,
    isActionable: true,
  };
}

const fullAnchorSet: IdentityAnchorSet = {
  characterName: 'Hana',
  headshot: makeImage({ id: 'anchor-h', shot_type: 'identity_headshot', is_primary: true }),
  profile: makeImage({ id: 'anchor-p', shot_type: 'identity_profile', is_primary: true }),
  fullBody: makeImage({ id: 'anchor-f', shot_type: 'identity_full_body', is_primary: true }),
  completeness: 'full_lock',
  anchorPaths: { headshot: 'a/h.png', profile: 'a/p.png', fullBody: 'a/f.png' },
};

describe('cached similarity wiring into ranking', () => {
  it('cached strong similarity boosts candidate rank', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const b = makeImage({ id: 'b', generation_config: { identity_locked: true } });

    const sims: Record<string, VisualSimilarityResult> = {
      a: makeResult(85), // strong
      b: makeResult(45), // weak
    };

    const result = rankCharacterCandidates([a, b], fullAnchorSet, null, sims);
    expect(result.top!.image.id).toBe('a');
    expect(result.ranked[0].similarityAdjustment).toBeGreaterThan(0);
    expect(result.ranked[1].similarityAdjustment).toBe(0);
  });

  it('cache miss (undefined) produces neutral ranking without crash', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const result = rankCharacterCandidates([a], fullAnchorSet, null, undefined);
    expect(result.top!.similarityAdjustment).toBe(0);
    expect(result.top!.visualSimilarity).toBeNull();
  });

  it('cache miss (empty object) produces neutral ranking', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const result = rankCharacterCandidates([a], fullAnchorSet, null, {});
    expect(result.top!.similarityAdjustment).toBe(0);
    expect(result.top!.visualSimilarity).toBeNull();
  });

  it('partial cache (some hits, some misses) ranks correctly', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const b = makeImage({ id: 'b', generation_config: { identity_locked: true } });

    // Only 'a' has cached similarity
    const sims: Record<string, VisualSimilarityResult> = {
      a: makeResult(90),
    };

    const result = rankCharacterCandidates([a, b], fullAnchorSet, null, sims);
    expect(result.top!.image.id).toBe('a');
    const bRanked = result.ranked.find(r => r.image.id === 'b')!;
    expect(bRanked.similarityAdjustment).toBe(0);
    expect(bRanked.visualSimilarity).toBeNull();
  });

  it('repeated ranking calls with same cache produce identical results', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const b = makeImage({ id: 'b', generation_config: { identity_locked: true } });

    const sims: Record<string, VisualSimilarityResult> = {
      a: makeResult(75),
      b: makeResult(60),
    };

    const r1 = rankCharacterCandidates([a, b], fullAnchorSet, null, sims);
    const r2 = rankCharacterCandidates([a, b], fullAnchorSet, null, sims);

    expect(r1.top!.image.id).toBe(r2.top!.image.id);
    expect(r1.ranked.map(r => r.image.id)).toEqual(r2.ranked.map(r => r.image.id));
    expect(r1.ranked.map(r => r.rankValue)).toEqual(r2.ranked.map(r => r.rankValue));
  });

  it('low similarity penalizes even a metadata-locked candidate', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const sims: Record<string, VisualSimilarityResult> = {
      a: makeResult(30), // low
    };
    const result = rankCharacterCandidates([a], fullAnchorSet, null, sims);
    expect(result.top!.similarityAdjustment).toBe(-8);
    expect(result.top!.rankReason).toContain('low visual similarity');
  });
});
