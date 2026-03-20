/**
 * Regression tests for character identity anchor set resolution,
 * continuity classification, drift penalty, and generation priority.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveIdentityAnchorsFromImages,
  classifyIdentityContinuity,
  computeIdentityDriftPenalty,
  shouldPrioritizeIdentityGeneration,
  type IdentityAnchorMap,
} from '../characterIdentityAnchorSet';
import type { ProjectImage } from '../types';

// ── Helpers ──

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
    storage_path: 'path/img.png',
    storage_bucket: 'project-posters',
    width: 1024,
    height: 1024,
    is_primary: false,
    is_active: true,
    source_poster_id: null,
    created_at: '2025-01-01',
    created_by: null,
    user_id: 'u1',
    provider: 'test',
    model: 'test',
    style_mode: 'cinematic',
    generation_config: {},
    asset_group: 'character',
    subject: 'Hana',
    shot_type: null,
    curation_state: 'active',
    subject_type: null,
    subject_ref: null,
    generation_purpose: 'character_identity',
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

// ── resolveIdentityAnchorsFromImages ──

describe('resolveIdentityAnchorsFromImages', () => {
  it('returns empty map when no identity primaries exist', () => {
    const images = [makeImage({ is_primary: false, shot_type: 'close_up' })];
    const map = resolveIdentityAnchorsFromImages(images);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('returns no_anchors when primary exists but not identity shot type', () => {
    const images = [makeImage({ is_primary: true, shot_type: 'close_up' })];
    const map = resolveIdentityAnchorsFromImages(images);
    expect(Object.keys(map)).toHaveLength(0);
  });

  it('returns partial_lock when only headshot primary exists', () => {
    const images = [
      makeImage({ id: 'h1', is_primary: true, shot_type: 'identity_headshot', storage_path: 'h.png' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);
    expect(map['Hana']).toBeDefined();
    expect(map['Hana'].completeness).toBe('partial_lock');
    expect(map['Hana'].headshot).not.toBeNull();
    expect(map['Hana'].profile).toBeNull();
    expect(map['Hana'].fullBody).toBeNull();
    expect(map['Hana'].anchorPaths.headshot).toBe('h.png');
  });

  it('returns full_lock when headshot + profile + full_body primaries exist', () => {
    const images = [
      makeImage({ id: 'h1', is_primary: true, shot_type: 'identity_headshot', storage_path: 'h.png' }),
      makeImage({ id: 'p1', is_primary: true, shot_type: 'identity_profile', storage_path: 'p.png' }),
      makeImage({ id: 'f1', is_primary: true, shot_type: 'identity_full_body', storage_path: 'f.png' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);
    expect(map['Hana'].completeness).toBe('full_lock');
    expect(map['Hana'].anchorPaths.headshot).toBe('h.png');
    expect(map['Hana'].anchorPaths.fullBody).toBe('f.png');
  });

  it('handles multiple characters independently', () => {
    const images = [
      makeImage({ id: 'h1', subject: 'Hana', is_primary: true, shot_type: 'identity_headshot' }),
      makeImage({ id: 'h2', subject: 'Kageyama', is_primary: true, shot_type: 'identity_headshot' }),
      makeImage({ id: 'f2', subject: 'Kageyama', is_primary: true, shot_type: 'identity_full_body' }),
      makeImage({ id: 'p2', subject: 'Kageyama', is_primary: true, shot_type: 'identity_profile' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);
    expect(map['Hana'].completeness).toBe('partial_lock');
    expect(map['Kageyama'].completeness).toBe('full_lock');
  });

  it('ignores non-active curation states', () => {
    const images = [
      makeImage({ is_primary: true, shot_type: 'identity_headshot', curation_state: 'archived' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);
    expect(Object.keys(map)).toHaveLength(0);
  });
});

// ── classifyIdentityContinuity ──

describe('classifyIdentityContinuity', () => {
  it('returns unknown for non-character images', () => {
    const img = makeImage({ asset_group: 'world' });
    const result = classifyIdentityContinuity(img, null);
    expect(result.status).toBe('unknown');
  });

  it('returns strong_match when identity_locked is true', () => {
    const img = makeImage({ generation_config: { identity_locked: true } });
    const result = classifyIdentityContinuity(img, null);
    expect(result.status).toBe('strong_match');
  });

  it('returns strong_match when both identity_locked and anchor_paths exist', () => {
    const img = makeImage({
      generation_config: { identity_locked: true, identity_anchor_paths: { headshot: 'h.png' } },
    });
    const result = classifyIdentityContinuity(img, null);
    expect(result.status).toBe('strong_match');
  });

  it('returns partial_match when only anchor_paths exist (no lock flag)', () => {
    const img = makeImage({
      generation_config: { identity_anchor_paths: { headshot: 'h.png' } },
    });
    const result = classifyIdentityContinuity(img, null);
    expect(result.status).toBe('partial_match');
  });

  it('returns no_anchor_context when no anchors exist for character', () => {
    const img = makeImage({ generation_config: {} });
    const anchorSet = { characterName: 'Hana', headshot: null, profile: null, fullBody: null, completeness: 'no_anchors' as const, anchorPaths: {} };
    const result = classifyIdentityContinuity(img, anchorSet);
    expect(result.status).toBe('no_anchor_context');
  });

  it('returns identity_drift when anchors exist but image was not generated with them', () => {
    const img = makeImage({ generation_config: {} });
    const anchorSet = {
      characterName: 'Hana',
      headshot: makeImage({ shot_type: 'identity_headshot' }),
      profile: null,
      fullBody: null,
      completeness: 'partial_lock' as const,
      anchorPaths: { headshot: 'h.png' },
    };
    const result = classifyIdentityContinuity(img, anchorSet);
    expect(result.status).toBe('identity_drift');
  });
});

// ── computeIdentityDriftPenalty ──

describe('computeIdentityDriftPenalty', () => {
  it('returns 0 penalty for strong_match', () => {
    const img = makeImage({ generation_config: { identity_locked: true } });
    const result = computeIdentityDriftPenalty(img, null);
    expect(result.penalty).toBe(0);
  });

  it('returns -5 penalty for partial_match', () => {
    const img = makeImage({ generation_config: { identity_anchor_paths: { headshot: 'h.png' } } });
    const result = computeIdentityDriftPenalty(img, null);
    expect(result.penalty).toBe(-5);
  });

  it('returns -25 penalty for identity_drift', () => {
    const img = makeImage({ generation_config: {} });
    const anchorSet = {
      characterName: 'Hana',
      headshot: makeImage({ shot_type: 'identity_headshot' }),
      profile: null,
      fullBody: null,
      completeness: 'partial_lock' as const,
      anchorPaths: { headshot: 'h.png' },
    };
    const result = computeIdentityDriftPenalty(img, anchorSet);
    expect(result.penalty).toBe(-25);
  });

  it('returns 0 penalty when no anchors available', () => {
    const img = makeImage({ generation_config: {} });
    const anchorSet = { characterName: 'Hana', headshot: null, profile: null, fullBody: null, completeness: 'no_anchors' as const, anchorPaths: {} };
    const result = computeIdentityDriftPenalty(img, anchorSet);
    expect(result.penalty).toBe(0);
  });
});

// ── shouldPrioritizeIdentityGeneration ──

describe('shouldPrioritizeIdentityGeneration', () => {
  it('returns all 3 missing slots when character has no anchors', () => {
    const map: IdentityAnchorMap = {};
    const result = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(result.prioritize).toBe(true);
    expect(result.missingSlots).toEqual(['identity_headshot', 'identity_profile', 'identity_full_body']);
  });

  it('returns missing profile and full_body when only headshot exists', () => {
    const map: IdentityAnchorMap = {
      Hana: {
        characterName: 'Hana',
        headshot: makeImage({ shot_type: 'identity_headshot' }),
        profile: null,
        fullBody: null,
        completeness: 'partial_lock',
        anchorPaths: { headshot: 'h.png' },
      },
    };
    const result = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(result.prioritize).toBe(true);
    expect(result.missingSlots).toEqual(['identity_profile', 'identity_full_body']);
  });

  it('returns no priority when full_lock achieved', () => {
    const map: IdentityAnchorMap = {
      Hana: {
        characterName: 'Hana',
        headshot: makeImage({ shot_type: 'identity_headshot' }),
        profile: makeImage({ shot_type: 'identity_profile' }),
        fullBody: makeImage({ shot_type: 'identity_full_body' }),
        completeness: 'full_lock',
        anchorPaths: { headshot: 'h.png', fullBody: 'f.png' },
      },
    };
    const result = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(result.prioritize).toBe(false);
    expect(result.missingSlots).toEqual([]);
  });
});
