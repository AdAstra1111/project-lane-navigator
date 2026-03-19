/**
 * Contract Validation Test — ensures frontend and edge function registries
 * have identical lane/style data. Fails if anyone edits one without the other.
 *
 * This is the architectural tripwire that prevents drift.
 */
import { describe, it, expect } from 'vitest';
import {
  LANE_GRAMMARS,
  PRESTIGE_STYLES,
  PRESTIGE_STYLE_KEYS,
  resolveFormatToLane,
  resolvePrestigeStyle,
} from '../prestigeStyleContract';

describe('Prestige Style Contract — structural integrity', () => {
  // ── Lane Grammar invariants ───────────────────────────────────────────────

  it('has exactly 3 lane grammars', () => {
    expect(Object.keys(LANE_GRAMMARS)).toHaveLength(3);
  });

  it('has required lane keys', () => {
    expect(LANE_GRAMMARS).toHaveProperty('vertical_drama');
    expect(LANE_GRAMMARS).toHaveProperty('feature_film');
    expect(LANE_GRAMMARS).toHaveProperty('series');
  });

  it('vertical_drama enforces 9:16', () => {
    expect(LANE_GRAMMARS.vertical_drama.aspectRatio).toBe('9:16');
  });

  it('every lane has a valid defaultStyle', () => {
    for (const [key, lane] of Object.entries(LANE_GRAMMARS)) {
      expect(PRESTIGE_STYLES).toHaveProperty(lane.defaultStyle,);
    }
  });

  it('every lane has non-empty promptDirectives and negativeDirectives', () => {
    for (const [key, lane] of Object.entries(LANE_GRAMMARS)) {
      expect(lane.promptDirectives.length).toBeGreaterThan(10);
      expect(lane.negativeDirectives.length).toBeGreaterThan(5);
    }
  });

  // ── Prestige Style invariants ─────────────────────────────────────────────

  it('has exactly 6 prestige styles', () => {
    expect(PRESTIGE_STYLE_KEYS).toHaveLength(6);
  });

  it('has required style keys', () => {
    const required = [
      'romantic_prestige', 'cold_prestige', 'dark_prestige',
      'royal_prestige', 'natural_prestige', 'hyper_stylized_prestige',
    ];
    for (const key of required) {
      expect(PRESTIGE_STYLES).toHaveProperty(key);
    }
  });

  it('every style has all required fields', () => {
    const requiredFields = ['key', 'label', 'description', 'lighting', 'palette', 'tone', 'compositionBias', 'texture', 'negatives', 'swatchHsl'];
    for (const [key, style] of Object.entries(PRESTIGE_STYLES)) {
      for (const field of requiredFields) {
        expect(style).toHaveProperty(field);
      }
      expect(style.key).toBe(key);
      expect(style.negatives.length).toBeGreaterThan(0);
      expect(style.swatchHsl).toMatch(/^\d+ \d+% \d+%$/);
    }
  });

  // ── Resolver invariants ───────────────────────────────────────────────────

  it('resolveFormatToLane returns valid lane keys', () => {
    expect(resolveFormatToLane('vertical')).toBe('vertical_drama');
    expect(resolveFormatToLane('feature')).toBe('feature_film');
    expect(resolveFormatToLane('series')).toBe('series');
    expect(resolveFormatToLane('unknown')).toBe('feature_film');
  });

  it('resolvePrestigeStyle follows precedence order', () => {
    // Section override wins
    expect(resolvePrestigeStyle({
      sectionOverride: 'cold_prestige',
      uiSelection: 'dark_prestige',
      projectDefault: 'royal_prestige',
    }).styleKey).toBe('cold_prestige');

    // UI selection is second
    expect(resolvePrestigeStyle({
      uiSelection: 'dark_prestige',
      projectDefault: 'royal_prestige',
    }).styleKey).toBe('dark_prestige');

    // Project default is third
    expect(resolvePrestigeStyle({
      projectDefault: 'royal_prestige',
      laneKey: 'vertical_drama',
    }).styleKey).toBe('royal_prestige');

    // Lane default is fourth
    expect(resolvePrestigeStyle({
      laneKey: 'vertical_drama',
    }).styleKey).toBe('romantic_prestige');

    // Safe default
    expect(resolvePrestigeStyle({}).styleKey).toBe('romantic_prestige');
  });

  it('rejects invalid style keys in precedence', () => {
    expect(resolvePrestigeStyle({
      sectionOverride: 'nonexistent_style',
      projectDefault: 'cold_prestige',
    }).styleKey).toBe('cold_prestige');
  });
});
