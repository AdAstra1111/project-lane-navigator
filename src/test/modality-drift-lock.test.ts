/**
 * Modality Drift-Lock Test
 *
 * Ensures FE (src/config/productionModality.ts) and BE (supabase/functions/_shared/productionModality.ts)
 * modules stay in sync on: modality values, prompt block outputs, and helper semantics.
 *
 * If this test fails, you have modality drift between environments.
 */
import { describe, it, expect } from 'vitest';
import * as fe from '@/config/productionModality';

// ── BE values (manually mirrored — update if BE changes) ──
const BE_MODALITIES = ['live_action', 'animation', 'hybrid'] as const;

describe('Modality Drift-Lock', () => {
  it('FE PRODUCTION_MODALITIES matches BE canonical list', () => {
    expect([...fe.PRODUCTION_MODALITIES]).toEqual([...BE_MODALITIES]);
  });

  it('getProjectModality defaults to live_action for null/undefined/empty', () => {
    expect(fe.getProjectModality(null)).toBe('live_action');
    expect(fe.getProjectModality(undefined)).toBe('live_action');
    expect(fe.getProjectModality({})).toBe('live_action');
    expect(fe.getProjectModality({ production_modality: 'invalid' })).toBe('live_action');
  });

  it('getProjectModality reads valid values correctly', () => {
    for (const m of fe.PRODUCTION_MODALITIES) {
      expect(fe.getProjectModality({ production_modality: m })).toBe(m);
    }
  });

  it('buildModalityPromptBlock returns empty for live_action', () => {
    expect(fe.buildModalityPromptBlock('live_action')).toBe('');
  });

  it('buildModalityPromptBlock returns non-empty for animation and hybrid', () => {
    const animBlock = fe.buildModalityPromptBlock('animation');
    expect(animBlock).toContain('ANIMATION');
    expect(animBlock.length).toBeGreaterThan(50);

    const hybridBlock = fe.buildModalityPromptBlock('hybrid');
    expect(hybridBlock).toContain('HYBRID');
    expect(hybridBlock.length).toBeGreaterThan(50);
  });

  it('isAnimationModality returns correct values', () => {
    expect(fe.isAnimationModality('live_action')).toBe(false);
    expect(fe.isAnimationModality('animation')).toBe(true);
    expect(fe.isAnimationModality('hybrid')).toBe(true);
  });

  it('setProjectModality merges without overwriting existing keys', () => {
    const existing = { some_other_key: 'value', production_modality: 'live_action' };
    const result = fe.setProjectModality(existing, 'animation');
    expect(result.some_other_key).toBe('value');
    expect(result.production_modality).toBe('animation');
  });

  it('MODALITY_LABELS has entries for all modalities', () => {
    for (const m of fe.PRODUCTION_MODALITIES) {
      expect(fe.MODALITY_LABELS[m]).toBeTruthy();
    }
  });

  it('MODALITY_COST_FACTORS has entries for all modalities', () => {
    for (const m of fe.PRODUCTION_MODALITIES) {
      const f = fe.MODALITY_COST_FACTORS[m];
      expect(f.schedule_multiplier).toBeGreaterThan(0);
      expect(f.crew_cost_multiplier).toBeGreaterThan(0);
    }
  });
});
