/**
 * Identity Alignment Scoring Engine — Regression tests.
 */
import { describe, it, expect } from 'vitest';
import {
  scoreCandidate,
  rankCandidatesForSlot,
  computeCharacterAlignment,
  type IdentitySlot,
} from '../identityAlignmentScoring';
import type { ProjectImage } from '../types';
import type { CharacterVisualDNA } from '../visualDNA';
import type { BindingMarker } from '../characterTraits';

function makeImage(overrides: Partial<ProjectImage> = {}): ProjectImage {
  return {
    id: 'img-1',
    project_id: 'proj-1',
    role: 'character_primary',
    entity_id: null,
    strategy_key: null,
    prompt_used: 'A headshot of a scarred man with short hair',
    negative_prompt: '',
    canon_constraints: {},
    storage_path: 'test/path.png',
    storage_bucket: 'project-posters',
    width: 512,
    height: 512,
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
    subject: 'John',
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

function makeMarker(overrides: Partial<BindingMarker> = {}): BindingMarker {
  return {
    id: 'marker-1',
    markerType: 'scar',
    label: 'scar on cheek',
    bodyRegion: 'cheek',
    laterality: 'left',
    size: 'medium',
    visibility: 'always_visible',
    attributes: {},
    status: 'approved',
    requiresUserDecision: false,
    unresolvedFields: [],
    confidence: 'high',
    evidenceSource: 'script',
    evidenceExcerpt: 'a scar runs across his left cheek',
    approvedAt: '2025-01-01',
    approvedBy: 'user-1',
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('exact slot match scores high and is canon-promotable', () => {
    const img = makeImage({ shot_type: 'identity_headshot' });
    const result = scoreCandidate(img, 'identity_headshot', null, null, [], null);
    expect(result.eligible).toBe(true);
    expect(result.canonPromotable).toBe(true);
    expect(result.componentScores.slotMatch).toBe(100);
    expect(result.totalScore).toBeGreaterThan(0);
  });

  it('cross-shot candidate is eligible but NOT canon-promotable', () => {
    const img = makeImage({ shot_type: 'close_up' });
    const result = scoreCandidate(img, 'identity_headshot', null, null, [], null);
    expect(result.eligible).toBe(true);
    expect(result.canonPromotable).toBe(false);
    expect(result.recommendedAction).not.toBe('promote');
  });

  it('cross-shot candidate cannot have promote action even with high score', () => {
    const img = makeImage({ shot_type: 'close_up', generation_purpose: 'character_identity', curation_state: 'active' });
    const result = scoreCandidate(img, 'identity_headshot', null, null, [], null);
    expect(result.canonPromotable).toBe(false);
    expect(result.recommendedAction).not.toBe('promote');
  });

  it('incompatible shot type is ineligible', () => {
    const img = makeImage({ shot_type: 'atmospheric' });
    const result = scoreCandidate(img, 'identity_headshot', null, null, [], null);
    expect(result.eligible).toBe(false);
    expect(result.canonPromotable).toBe(false);
    expect(result.totalScore).toBe(0);
    expect(result.recommendedAction).toBe('reject_for_slot');
  });

  it('approved cheek scar is applicable for headshot', () => {
    const marker = makeMarker({ bodyRegion: 'cheek', status: 'approved' });
    const dna = { bindingMarkers: [marker] } as unknown as CharacterVisualDNA;
    const img = makeImage({ shot_type: 'identity_headshot', prompt_used: 'portrait with scar on cheek' });
    const result = scoreCandidate(img, 'identity_headshot', dna, null, [], null);
    expect(result.componentScores.markerScore).toBe(100);
  });

  it('arm tattoo is NOT applicable for headshot', () => {
    const marker = makeMarker({ markerType: 'tattoo', label: 'tattoo on arm', bodyRegion: 'arm', status: 'approved' });
    const dna = { bindingMarkers: [marker] } as unknown as CharacterVisualDNA;
    const img = makeImage({ shot_type: 'identity_headshot' });
    const result = scoreCandidate(img, 'identity_headshot', dna, null, [], null);
    // Should be neutral (50) — not penalized
    expect(result.componentScores.markerScore).toBe(50);
  });

  it('transient states in DNA do not count as permanent identity', () => {
    const dna = {
      bindingMarkers: [],
      transientStates: [{ label: 'sweating', category: 'other' }],
    } as unknown as CharacterVisualDNA;
    const img = makeImage({ prompt_used: 'dry clean portrait' });
    const result = scoreCandidate(img, 'identity_headshot', dna, null, [], null);
    // Transient state absence should NOT hurt score
    expect(result.totalScore).toBeGreaterThan(30);
  });

  it('rejected markers do not contribute to scoring', () => {
    const marker = makeMarker({ status: 'rejected' });
    const dna = { bindingMarkers: [marker] } as unknown as CharacterVisualDNA;
    const img = makeImage();
    const result = scoreCandidate(img, 'identity_headshot', dna, null, [], null);
    expect(result.componentScores.markerScore).toBe(50); // neutral
  });

  it('pending_resolution markers do not contribute to scoring', () => {
    const marker = makeMarker({ status: 'pending_resolution' });
    const dna = { bindingMarkers: [marker] } as unknown as CharacterVisualDNA;
    const img = makeImage();
    const result = scoreCandidate(img, 'identity_headshot', dna, null, [], null);
    expect(result.componentScores.markerScore).toBe(50);
  });

  it('archived images get penalty', () => {
    const img = makeImage({ curation_state: 'archived' });
    const result = scoreCandidate(img, 'identity_headshot', null, null, [], null);
    expect(result.componentScores.penalty).toBe(20);
  });
});

describe('rankCandidatesForSlot', () => {
  it('deterministic ordering on tied scores', () => {
    const img1 = makeImage({ id: 'aaa', shot_type: 'identity_headshot', created_at: '2025-01-01T00:00:00Z' });
    const img2 = makeImage({ id: 'bbb', shot_type: 'identity_headshot', created_at: '2025-01-02T00:00:00Z' });
    const result = rankCandidatesForSlot([img1, img2], 'identity_headshot', null, null, [], new Map());
    // img2 is newer → should rank first as tiebreaker
    expect(result.rankedCandidates[0].candidateId).toBe('bbb');
    expect(result.rankedCandidates[1].candidateId).toBe('aaa');
  });

  it('returns no recommendation when no candidates', () => {
    const result = rankCandidatesForSlot([], 'identity_headshot', null, null, [], new Map());
    expect(result.bestCandidate).toBeNull();
    expect(result.noRecommendationReason).toBeTruthy();
  });
});

describe('computeCharacterAlignment', () => {
  it('returns all 3 slots', () => {
    const result = computeCharacterAlignment('John', [], null, null, [], new Map());
    expect(result.slots).toHaveLength(3);
    expect(result.slots.map(s => s.slot)).toEqual(['identity_headshot', 'identity_profile', 'identity_full_body']);
  });

  it('handles legacy direct identity_signature', () => {
    const legacySig = {
      face: { jawShape: 'angular', cheekboneStructure: null, noseProfile: null, eyeSpacing: null, distinctiveFeatures: [] },
      body: { heightClass: 'tall', build: 'lean', shoulderWidth: null, limbProportions: null },
      silhouette: { posture: null, stanceTendency: null, presence: null },
      wardrobeBaseline: { style: null, fit: null, paletteRange: null },
    };
    const img = makeImage({ prompt_used: 'portrait of angular tall lean man' });
    const result = computeCharacterAlignment('John', [img], null, legacySig as any, [], new Map());
    const headshot = result.slots.find(s => s.slot === 'identity_headshot');
    expect(headshot?.bestCandidate).toBeTruthy();
    expect(headshot!.bestCandidate!.componentScores.identitySig).toBeGreaterThan(50);
  });

  it('handles composite identity_signature', () => {
    const compositeSig = {
      signature: {
        face: { jawShape: 'angular', cheekboneStructure: null, noseProfile: null, eyeSpacing: null, distinctiveFeatures: [] },
        body: { heightClass: 'tall', build: null, shoulderWidth: null, limbProportions: null },
        silhouette: { posture: null, stanceTendency: null, presence: null },
        wardrobeBaseline: { style: null, fit: null, paletteRange: null },
      },
      binding_markers: [],
      evidence_traits: [],
    };
    const img = makeImage({ prompt_used: 'angular jawline tall man' });
    const result = computeCharacterAlignment('John', [img], null, compositeSig as any, [], new Map());
    const headshot = result.slots.find(s => s.slot === 'identity_headshot');
    expect(headshot?.bestCandidate?.componentScores.identitySig).toBeGreaterThan(50);
  });
});
