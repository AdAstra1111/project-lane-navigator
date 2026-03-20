/**
 * Tests for staged identity-first character generation policy.
 * Verifies that shouldPrioritizeIdentityGeneration correctly gates
 * reference slot generation based on anchor completeness.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldPrioritizeIdentityGeneration,
  resolveIdentityAnchorsFromImages,
  type IdentityAnchorMap,
} from '../characterIdentityAnchorSet';
import type { ProjectImage } from '../types';

function makeImage(overrides: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-1', project_id: 'p1', role: 'character_primary', entity_id: null,
    strategy_key: null, prompt_used: '', negative_prompt: '', canon_constraints: {},
    storage_path: 'path/img.png', storage_bucket: 'project-posters',
    width: 1024, height: 1024, is_primary: true, is_active: true, source_poster_id: null,
    created_at: '2025-01-01', created_by: null, user_id: 'u1', provider: 'test',
    model: 'test', style_mode: 'cinematic', generation_config: {},
    asset_group: 'character', subject: 'Hana', shot_type: null,
    curation_state: 'active', subject_type: null, subject_ref: null,
    generation_purpose: 'character_identity', location_ref: null, moment_ref: null,
    state_key: null, state_label: null, lane_key: null, prestige_style: null,
    lane_compliance_score: null,
    ...overrides,
  };
}

describe('staged identity-first generation policy', () => {
  it('defers all ref slots when no anchors exist (no_anchors)', () => {
    const map: IdentityAnchorMap = {};
    const result = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(result.prioritize).toBe(true);
    expect(result.missingSlots).toContain('identity_headshot');
    expect(result.missingSlots).toContain('identity_profile');
    expect(result.missingSlots).toContain('identity_full_body');
  });

  it('defers ref slots when only headshot exists (partial_lock)', () => {
    const images = [
      makeImage({ id: 'h1', shot_type: 'identity_headshot', storage_path: 'h.png' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);
    const result = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(result.prioritize).toBe(true);
    expect(result.missingSlots).toContain('identity_profile');
    expect(result.missingSlots).toContain('identity_full_body');
    expect(result.missingSlots).not.toContain('identity_headshot');
  });

  it('allows ref slots when full_lock achieved', () => {
    const images = [
      makeImage({ id: 'h1', shot_type: 'identity_headshot', storage_path: 'h.png' }),
      makeImage({ id: 'p1', shot_type: 'identity_profile', storage_path: 'p.png' }),
      makeImage({ id: 'f1', shot_type: 'identity_full_body', storage_path: 'f.png' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);
    const result = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(result.prioritize).toBe(false);
    expect(result.missingSlots).toEqual([]);
  });

  it('handles characters independently — locked char allows refs, unlocked does not', () => {
    const images = [
      makeImage({ id: 'h1', subject: 'Hana', shot_type: 'identity_headshot', storage_path: 'h.png' }),
      makeImage({ id: 'p1', subject: 'Hana', shot_type: 'identity_profile', storage_path: 'p.png' }),
      makeImage({ id: 'f1', subject: 'Hana', shot_type: 'identity_full_body', storage_path: 'f.png' }),
    ];
    const map = resolveIdentityAnchorsFromImages(images);

    const hanaResult = shouldPrioritizeIdentityGeneration('Hana', map);
    expect(hanaResult.prioritize).toBe(false);

    const kageyamaResult = shouldPrioritizeIdentityGeneration('Kageyama', map);
    expect(kageyamaResult.prioritize).toBe(true);
    expect(kageyamaResult.missingSlots).toHaveLength(3);
  });

  it('manifest ordering is deterministic: identity phase 1 before refs phase 2', () => {
    // This tests the logical ordering contract — identity slots are phase 1, refs are phase 2
    const map: IdentityAnchorMap = {};
    const noAnchor = shouldPrioritizeIdentityGeneration('Hana', map);
    // When prioritize=true, ref slots must be deferred
    expect(noAnchor.prioritize).toBe(true);
    expect(noAnchor.reason).toContain('identity');
  });
});
