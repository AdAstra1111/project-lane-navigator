/**
 * Tests for lookbookRebuildTrigger — deterministic trigger conditions + mode selection
 */
import { describe, it, expect } from 'vitest';
import { evaluateRebuildTrigger, getTriggerConditionLabel } from '../lookbookRebuildTrigger';

// Minimal image stub
function img(overrides: Partial<{ is_primary: boolean; curation_state: string; width: number; height: number; subject: string; shot_type: string; asset_group: string }> = {}): any {
  return {
    id: crypto.randomUUID?.() || Math.random().toString(36),
    project_id: 'p1',
    is_primary: false,
    is_active: true,
    curation_state: 'active',
    width: 1024,
    height: 1792,
    subject: 'Test',
    shot_type: 'close_up',
    asset_group: 'character_identity',
    ...overrides,
  };
}

describe('evaluateRebuildTrigger', () => {
  const canon = { characters: [{ name: 'Alice' }], locations: [{ name: 'Forest' }] };

  it('returns shouldRebuild=true when no images exist', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    expect(result.shouldRebuild).toBe(true);
    expect(result.conditions).toContain('missing_primaries');
    expect(result.slotSummary.emptySlots).toBeGreaterThan(0);
  });

  it('returns shouldRebuild=false with forceTriggered override', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio', { forceTriggered: true });
    expect(result.shouldRebuild).toBe(true);
  });

  it('recommends RESET when no primaries exist', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    expect(result.recommendedMode).toBe('RESET_FULL_CANON_REBUILD');
  });

  it('recommends RESET on canon_changed explicit condition', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio', {
      explicitCondition: 'canon_changed',
    });
    expect(result.recommendedMode).toBe('RESET_FULL_CANON_REBUILD');
    expect(result.modeReason).toContain('Canon changed');
  });
});

describe('getTriggerConditionLabel', () => {
  it('returns human-readable labels', () => {
    expect(getTriggerConditionLabel('missing_primaries')).toBe('Missing primary images');
    expect(getTriggerConditionLabel('non_compliant_primaries')).toBe('Non-compliant primary images detected');
    expect(getTriggerConditionLabel('explicit_request')).toBe('Manually requested');
  });
});
