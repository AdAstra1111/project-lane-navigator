/**
 * ImageComparisonView — continuity decision support tests
 */
import { describe, it, expect } from 'vitest';
import { classifyIdentityContinuity } from '@/lib/images/characterIdentityAnchorSet';
import type { ProjectImage } from '@/lib/images/types';

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
    created_at: '',
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

describe('ComparisonView continuity classification integration', () => {
  it('strong_match candidate is preferred over drift candidate', () => {
    const locked = makeImage({ id: 'a', generation_config: { identity_locked: true } });
    const drifted = makeImage({ id: 'b', generation_config: {} });
    const anchorSet = {
      characterName: 'Hana',
      headshot: null,
      profile: null,
      fullBody: null,
      completeness: 'partial_lock' as const,
      anchorPaths: { headshot: 'h.png' },
    };

    const lockedResult = classifyIdentityContinuity(locked, anchorSet);
    const driftedResult = classifyIdentityContinuity(drifted, anchorSet);

    expect(lockedResult.status).toBe('strong_match');
    expect(driftedResult.status).toBe('identity_drift');
  });

  it('no_anchor_context when no anchors exist', () => {
    const img = makeImage({ generation_config: {} });
    const noAnchors = {
      characterName: 'Hana',
      headshot: null,
      profile: null,
      fullBody: null,
      completeness: 'no_anchors' as const,
      anchorPaths: {},
    };
    const result = classifyIdentityContinuity(img, noAnchors);
    expect(result.status).toBe('no_anchor_context');
  });

  it('non-character images classified as unknown', () => {
    const world = makeImage({ asset_group: 'world', subject: null });
    const result = classifyIdentityContinuity(world, null);
    expect(result.status).toBe('unknown');
  });

  it('partial_match when anchors used without lock flag', () => {
    const img = makeImage({
      generation_config: { identity_anchor_paths: { headshot: 'h.png' } },
    });
    const result = classifyIdentityContinuity(img, null);
    expect(result.status).toBe('partial_match');
  });
});
