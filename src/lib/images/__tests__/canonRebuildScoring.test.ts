/**
 * Canon Rebuild Scoring Engine — Tests for NULL-dimension handling and VD enforcement.
 */
import { describe, it, expect } from 'vitest';
import { scoreCandidateForSlot, selectSlotWinner, type SlotTarget } from '../canonRebuildScoring';
import type { ProjectImage } from '../types';

function makeImage(overrides: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-1',
    project_id: 'proj-1',
    role: 'character_primary',
    entity_id: null,
    strategy_key: null,
    prompt_used: 'test prompt',
    negative_prompt: '',
    canon_constraints: {},
    storage_path: 'test/path.png',
    storage_bucket: 'project-posters',
    width: null as any,
    height: null as any,
    is_primary: false,
    is_active: true,
    source_poster_id: null,
    created_at: '2025-01-01T00:00:00Z',
    created_by: null,
    user_id: 'user-1',
    provider: 'test',
    model: 'test-model',
    style_mode: 'default',
    generation_config: {},
    asset_group: 'character',
    subject: 'Hana',
    shot_type: 'identity_headshot',
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

function makeSlot(overrides: Partial<SlotTarget> = {}): SlotTarget {
  return {
    key: 'character:Hana:identity:identity_headshot',
    assetGroup: 'character',
    subject: 'Hana',
    shotType: 'identity_headshot',
    expectedAspectRatio: '1:1',
    isIdentity: true,
    ...overrides,
  };
}

describe('scoreCandidateForSlot — NULL dimensions', () => {
  it('NULL-dimension identity image is portrait-safe via shot-type inference', () => {
    const img = makeImage({ width: null as any, height: null as any, shot_type: 'identity_headshot' });
    const slot = makeSlot();
    const result = scoreCandidateForSlot(img, slot, [img], true);
    expect(result.isPortraitSafe).toBe(true);
    expect(result.eligible).toBe(true);
    expect(result.totalScore).toBeGreaterThan(50);
  });

  it('NULL-dimension landscape shot with portrait override is portrait-safe', () => {
    const img = makeImage({ shot_type: 'wide', asset_group: 'world', subject: 'Forest', generation_purpose: 'lookbook_world' as any });
    const slot = makeSlot({ key: 'world:Forest:wide', assetGroup: 'world', subject: 'Forest', shotType: 'wide', expectedAspectRatio: '9:16', isIdentity: false });
    const result = scoreCandidateForSlot(img, slot, [img], true);
    expect(result.isPortraitSafe).toBe(true);
  });

  it('NULL-dimension unknown shot type is NOT portrait-safe', () => {
    const img = makeImage({ shot_type: null as any, generation_purpose: 'lookbook_world' as any });
    const slot = makeSlot();
    const result = scoreCandidateForSlot(img, slot, [img], true);
    expect(result.isPortraitSafe).toBe(false);
  });

  it('uses redistributed weights when dims are NULL for VD', () => {
    const img = makeImage({ shot_type: 'identity_headshot' });
    const slot = makeSlot();
    const result = scoreCandidateForSlot(img, slot, [img], true);
    // slotMatch should be 100 * 0.35 = 35 (boosted weight for no-dims VD)
    expect(result.components.slotMatch).toBe(100);
    expect(result.totalScore).toBeGreaterThan(60);
  });
});

describe('selectSlotWinner — VD portrait filtering', () => {
  it('selects portrait-safe winner even with NULL dimensions', () => {
    const img1 = makeImage({ id: 'aaa', shot_type: 'identity_headshot' });
    const img2 = makeImage({ id: 'bbb', shot_type: 'identity_headshot', created_at: '2025-01-02T00:00:00Z' });
    const slot = makeSlot();
    const result = selectSlotWinner([img1, img2], slot, true);
    expect(result.winner).not.toBeNull();
    expect(result.winner!.isPortraitSafe).toBe(true);
  });

  it('exact slot match beats cross-shot match in winner selection', () => {
    const exact = makeImage({ id: 'exact', shot_type: 'identity_headshot' });
    const cross = makeImage({ id: 'cross', shot_type: 'close_up', created_at: '2025-01-05T00:00:00Z' });
    const slot = makeSlot();
    const result = selectSlotWinner([exact, cross], slot, true);
    expect(result.winner!.imageId).toBe('exact');
  });

  it('correct subject beats wrong subject', () => {
    const right = makeImage({ id: 'right', subject: 'Hana', shot_type: 'identity_headshot' });
    const wrong = makeImage({ id: 'wrong', subject: 'Kenji', shot_type: 'identity_headshot', created_at: '2025-01-05T00:00:00Z' });
    const slot = makeSlot();
    const result = selectSlotWinner([right, wrong], slot, true);
    expect(result.winner!.imageId).toBe('right');
  });

  it('with pixel dims, landscape image excluded from VD winner pool', () => {
    const portrait = makeImage({ id: 'portrait', width: 720 as any, height: 1280 as any, shot_type: 'identity_headshot' });
    const landscape = makeImage({ id: 'landscape', width: 1280 as any, height: 720 as any, shot_type: 'identity_headshot', created_at: '2025-01-05T00:00:00Z' });
    const slot = makeSlot();
    const result = selectSlotWinner([portrait, landscape], slot, true);
    expect(result.winner!.imageId).toBe('portrait');
    expect(result.winner!.isPortraitSafe).toBe(true);
  });
});
