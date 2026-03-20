/**
 * Rebuild Mode Tests — verifies RESET vs PRESERVE behavior,
 * replacement thresholds, primarySetAlignment, and slot weakness.
 */
import { describe, it, expect } from 'vitest';
import {
  selectSlotWinner,
  classifySlotWeakness,
  shouldReplace,
  buildAlignmentAnchors,
  buildRebuildResult,
  PRESERVE_REPLACEMENT_THRESHOLD,
  type SlotTarget,
  type RebuildMode,
} from '../canonRebuildScoring';
import type { ProjectImage } from '../types';

const VD_FORMAT = 'vertical-drama';
const VD_LANE = 'vertical_drama';

function makeImage(overrides: Partial<ProjectImage> & { id: string }): ProjectImage {
  return {
    project_id: 'p1',
    storage_path: '',
    created_at: new Date().toISOString(),
    curation_state: 'candidate',
    is_active: false,
    is_primary: false,
    asset_group: 'character',
    subject: 'Alice',
    shot_type: 'wide',
    signedUrl: null,
    width: null,
    height: null,
    ...overrides,
  } as ProjectImage;
}

const SLOT: SlotTarget = {
  key: 'world:Forest:wide',
  assetGroup: 'world',
  subject: 'Forest',
  shotType: 'wide',
  expectedAspectRatio: '9:16',
  isIdentity: false,
};

describe('classifySlotWeakness', () => {
  it('unresolved when no incumbent', () => {
    const r = classifySlotWeakness(null, SLOT, true, VD_FORMAT, VD_LANE);
    expect(r.isWeak).toBe(true);
    expect(r.reasons).toContain('unresolved');
  });

  it('non_compliant when incumbent is landscape in VD', () => {
    const img = makeImage({ id: 'i1', width: 1280, height: 720, shot_type: 'wide', is_primary: true, curation_state: 'active' });
    const r = classifySlotWeakness(img, SLOT, true, VD_FORMAT, VD_LANE);
    expect(r.isWeak).toBe(true);
    expect(r.reasons).toContain('non_compliant');
  });

  it('not weak when incumbent is compliant and scored well', () => {
    const img = makeImage({ id: 'i1', width: 720, height: 1280, shot_type: 'wide', is_primary: true, curation_state: 'active' });
    const r = classifySlotWeakness(img, SLOT, true, VD_FORMAT, VD_LANE);
    expect(r.isWeak).toBe(false);
  });
});

describe('shouldReplace', () => {
  it('replaces when incumbent is non_compliant', () => {
    const r = shouldReplace(50, 60, { isWeak: true, reasons: ['non_compliant'] });
    expect(r.replace).toBe(true);
  });

  it('replaces when challenger exceeds threshold', () => {
    const r = shouldReplace(50, 50 + PRESERVE_REPLACEMENT_THRESHOLD, { isWeak: false, reasons: [] });
    expect(r.replace).toBe(true);
  });

  it('preserves when margin below threshold', () => {
    const r = shouldReplace(50, 55, { isWeak: false, reasons: [] });
    expect(r.replace).toBe(false);
  });

  it('preserves when challenger is worse', () => {
    const r = shouldReplace(60, 50, { isWeak: false, reasons: [] });
    expect(r.replace).toBe(false);
  });
});

describe('selectSlotWinner — RESET vs PRESERVE', () => {
  const compliantImg = makeImage({ id: 'c1', width: 720, height: 1280, shot_type: 'wide', asset_group: 'world', subject: 'Forest' });
  const incumbent = makeImage({ id: 'inc', width: 720, height: 1280, shot_type: 'wide', asset_group: 'world', subject: 'Forest', is_primary: true, curation_state: 'active' });

  it('RESET mode selects best scorer regardless of incumbent', () => {
    const r = selectSlotWinner([compliantImg], SLOT, true, VD_FORMAT, VD_LANE, {
      mode: 'RESET_FULL_CANON_REBUILD',
    });
    expect(r.winner).not.toBeNull();
    expect(r.incumbentPreserved).toBe(false);
  });

  it('PRESERVE mode keeps incumbent when no challenger beats threshold', () => {
    const r = selectSlotWinner([compliantImg], SLOT, true, VD_FORMAT, VD_LANE, {
      mode: 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD',
      incumbent,
    });
    expect(r.winner).not.toBeNull();
    expect(r.incumbentPreserved).toBe(true);
    expect(r.incumbentReplaced).toBe(false);
  });

  it('PRESERVE mode replaces non-compliant incumbent', () => {
    const badIncumbent = makeImage({ id: 'bad', width: 1280, height: 720, shot_type: 'wide', asset_group: 'world', subject: 'Forest', is_primary: true, curation_state: 'active' });
    const r = selectSlotWinner([compliantImg], SLOT, true, VD_FORMAT, VD_LANE, {
      mode: 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD',
      incumbent: badIncumbent,
    });
    expect(r.winner).not.toBeNull();
    expect(r.winner!.imageId).toBe('c1');
    expect(r.incumbentReplaced).toBe(true);
  });

  it('unresolved when no compliant candidates exist', () => {
    const landscape = makeImage({ id: 'l1', width: 1280, height: 720, shot_type: 'wide', asset_group: 'world', subject: 'Forest' });
    const r = selectSlotWinner([landscape], SLOT, true, VD_FORMAT, VD_LANE, {
      mode: 'RESET_FULL_CANON_REBUILD',
    });
    expect(r.winner).toBeNull();
    expect(r.noWinnerReason).toContain('vertical-compliant');
  });
});

describe('buildRebuildResult', () => {
  it('reports preserved and replaced counts honestly', () => {
    const results = [
      { slotKey: 's1', winner: { imageId: 'w1' } as any, allScored: [], noWinnerReason: null, complianceGate: null, incumbentPreserved: true, incumbentReplaced: false, incumbentId: 'w1' },
      { slotKey: 's2', winner: { imageId: 'w2' } as any, allScored: [], noWinnerReason: null, complianceGate: null, incumbentPreserved: false, incumbentReplaced: true, incumbentId: 'old' },
      { slotKey: 's3', winner: null, allScored: [], noWinnerReason: 'No candidates', complianceGate: null, incumbentPreserved: false, incumbentReplaced: false, incumbentId: null },
    ];
    const r = buildRebuildResult('PRESERVE_PRIMARIES_FULL_CANON_REBUILD', results, 10);
    expect(r.preservedPrimaryCount).toBe(1);
    expect(r.replacedPrimaryCount).toBe(1);
    expect(r.unresolvedSlots).toBe(1);
    expect(r.resolvedSlots).toBe(2);
    expect(r.winnerIds).toEqual(['w1', 'w2']);
  });
});
