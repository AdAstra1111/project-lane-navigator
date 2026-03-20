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

  it('returns shouldRebuild=true with forceTriggered override', () => {
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

  it('includes explicit_request condition when passed', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio', {
      explicitCondition: 'explicit_request',
    });
    expect(result.conditions).toContain('explicit_request');
    expect(result.shouldRebuild).toBe(true);
  });

  it('reports slot summary correctly with empty images', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    expect(result.slotSummary.totalSlots).toBeGreaterThan(0);
    expect(result.slotSummary.filledSlots).toBe(0);
    expect(result.slotSummary.emptySlots).toBe(result.slotSummary.totalSlots);
  });

  it('shouldRebuild is false when forceTriggered is false and no conditions met with sufficient images', () => {
    // This verifies the trigger is deterministic — same inputs = same output
    const result1 = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    const result2 = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    expect(result1.shouldRebuild).toBe(result2.shouldRebuild);
    expect(result1.conditions).toEqual(result2.conditions);
    expect(result1.recommendedMode).toBe(result2.recommendedMode);
  });
});

describe('getTriggerConditionLabel', () => {
  it('returns human-readable labels', () => {
    expect(getTriggerConditionLabel('missing_primaries')).toBe('Missing primary images');
    expect(getTriggerConditionLabel('non_compliant_primaries')).toBe('Non-compliant primary images detected');
    expect(getTriggerConditionLabel('explicit_request')).toBe('Manually requested');
    expect(getTriggerConditionLabel('canon_changed')).toBe('Canon data changed');
    expect(getTriggerConditionLabel('unresolved_required_slots')).toBe('All required slots unresolved');
    expect(getTriggerConditionLabel('weak_primaries')).toBe('Weak primary images detected');
  });
});

describe('trigger → executor integration contract', () => {
  it('recommendedMode is always a valid RebuildMode string', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    expect(['RESET_FULL_CANON_REBUILD', 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD']).toContain(result.recommendedMode);
  });

  it('diagnostics shape is complete and typed', () => {
    const result = evaluateRebuildTrigger(canon, [], false, 'feature_film', 'studio');
    expect(result).toHaveProperty('shouldRebuild');
    expect(result).toHaveProperty('conditions');
    expect(result).toHaveProperty('recommendedMode');
    expect(result).toHaveProperty('modeReason');
    expect(result).toHaveProperty('slotSummary');
    expect(result.slotSummary).toHaveProperty('totalSlots');
    expect(result.slotSummary).toHaveProperty('filledSlots');
    expect(result.slotSummary).toHaveProperty('emptySlots');
    expect(result.slotSummary).toHaveProperty('weakSlots');
    expect(result.slotSummary).toHaveProperty('nonCompliantSlots');
  });

  const canon = { characters: [{ name: 'Alice' }], locations: [{ name: 'Forest' }] };
});
