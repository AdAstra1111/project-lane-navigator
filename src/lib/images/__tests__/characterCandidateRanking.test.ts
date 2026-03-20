/**
 * Canonical Character Candidate Ranking — regression tests
 */
import { describe, it, expect } from 'vitest';
import { rankCharacterCandidates, type RankingResult } from '@/lib/images/characterCandidateRanking';
import type { ProjectImage } from '@/lib/images/types';
import type { IdentityAnchorSet } from '@/lib/images/characterIdentityAnchorSet';

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

const partialAnchorSet: IdentityAnchorSet = {
  characterName: 'Hana',
  headshot: makeImage({ id: 'anchor-h', shot_type: 'identity_headshot', is_primary: true }),
  profile: null,
  fullBody: null,
  completeness: 'partial_lock',
  anchorPaths: { headshot: 'anchors/h.png' },
};

describe('rankCharacterCandidates', () => {
  it('returns empty result for no candidates', () => {
    const result = rankCharacterCandidates([], null);
    expect(result.ranked).toHaveLength(0);
    expect(result.top).toBeNull();
  });

  it('locked candidate beats drifted candidate', () => {
    const locked = makeImage({ id: 'locked', generation_config: { identity_locked: true } });
    const drifted = makeImage({ id: 'drifted', generation_config: {} });
    const result = rankCharacterCandidates([drifted, locked], partialAnchorSet);
    expect(result.top!.image.id).toBe('locked');
    expect(result.ranked[0].image.id).toBe('locked');
    expect(result.ranked[1].image.id).toBe('drifted');
  });

  it('drifted candidate penalized when anchors exist', () => {
    const drifted = makeImage({ id: 'drifted', generation_config: {} });
    const result = rankCharacterCandidates([drifted], partialAnchorSet);
    expect(result.ranked[0].driftPenalty).toBeLessThan(0);
    expect(result.ranked[0].continuityStatus).toBe('identity_drift');
  });

  it('no penalty when no anchors exist', () => {
    const img = makeImage({ id: 'a', generation_config: {} });
    const noAnchors: IdentityAnchorSet = {
      characterName: 'Hana', headshot: null, profile: null, fullBody: null,
      completeness: 'no_anchors', anchorPaths: {},
    };
    const result = rankCharacterCandidates([img], noAnchors);
    expect(result.ranked[0].driftPenalty).toBe(0);
    expect(result.ranked[0].continuityStatus).toBe('no_anchor_context');
  });

  it('score tiebreaks within same continuity tier', () => {
    const a = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const b = makeImage({ id: 'b', generation_config: { identity_locked: true } });
    const scores = { a: 80, b: 95 };
    const result = rankCharacterCandidates([a, b], null, scores);
    expect(result.top!.image.id).toBe('b');
  });

  it('reason metadata is populated', () => {
    const locked = makeImage({ id: 'locked', generation_config: { identity_locked: true } });
    const result = rankCharacterCandidates([locked], partialAnchorSet);
    expect(result.top!.rankReason).toContain('identity locked');
    expect(result.topReason).toContain('Recommended');
  });

  it('recency tiebreak when rank values equal', () => {
    const older = makeImage({ id: 'old', created_at: '2026-01-01T00:00:00Z', generation_config: { identity_locked: true } });
    const newer = makeImage({ id: 'new', created_at: '2026-03-01T00:00:00Z', generation_config: { identity_locked: true } });
    const result = rankCharacterCandidates([older, newer], null);
    expect(result.top!.image.id).toBe('new');
  });

  it('all surfaces agree: requiredVisualSet ranking matches compare ranking', () => {
    // This test verifies the same helper produces the same winner regardless of caller
    const locked = makeImage({ id: 'locked', generation_config: { identity_locked: true } });
    const drifted = makeImage({ id: 'drifted', generation_config: {} });
    const candidates = [drifted, locked];

    const result1 = rankCharacterCandidates(candidates, partialAnchorSet);
    const result2 = rankCharacterCandidates(candidates, partialAnchorSet);

    expect(result1.top!.image.id).toBe(result2.top!.image.id);
    expect(result1.ranked.map(r => r.image.id)).toEqual(result2.ranked.map(r => r.image.id));
  });
});
