/**
 * Document Ladders — Normalization & Lane Validation Tests
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeDocType,
  getLaneLadder,
  isDocTypeAllowedInLane,
  formatToLane,
  DOC_LABEL_ALIASES,
  LANE_DOC_LADDERS,
  BASE_DOC_TYPES,
} from '@/config/documentLadders';

describe('normalizeDocType', () => {
  it('lowercases and underscores', () => {
    expect(normalizeDocType('Beat Sheet')).toBe('beat_sheet');
  });

  it('resolves "Blueprint" to blueprint (canonical key)', () => {
    expect(normalizeDocType('Blueprint')).toBe('blueprint');
  });

  it('resolves "Architecture" to architecture (canonical key)', () => {
    expect(normalizeDocType('Architecture')).toBe('architecture');
  });

  it('resolves "treatment" to blueprint', () => {
    expect(normalizeDocType('treatment')).toBe('blueprint');
  });

  it('resolves "Series Bible" to blueprint', () => {
    expect(normalizeDocType('Series Bible')).toBe('blueprint');
  });

  it('resolves "plot_architecture" to architecture', () => {
    expect(normalizeDocType('plot_architecture')).toBe('architecture');
  });

  it('resolves "script" to feature_script', () => {
    expect(normalizeDocType('script')).toBe('feature_script');
  });

  it('resolves "draft" to feature_script', () => {
    expect(normalizeDocType('draft')).toBe('feature_script');
  });

  it('resolves "episode_beats" to vertical_episode_beats', () => {
    expect(normalizeDocType('episode_beats')).toBe('vertical_episode_beats');
  });

  it('passes through unknown types unchanged', () => {
    expect(normalizeDocType('my_custom_doc')).toBe('my_custom_doc');
  });

  it('handles hyphens', () => {
    expect(normalizeDocType('episode-beats')).toBe('vertical_episode_beats');
  });

  it('handles empty string', () => {
    expect(normalizeDocType('')).toBe('');
  });
});

describe('getLaneLadder', () => {
  it('returns feature_film ladder', () => {
    const ladder = getLaneLadder('feature_film');
    expect(ladder).toContain('blueprint');
    expect(ladder).toContain('feature_script');
    expect(ladder).not.toContain('episode_grid');
  });

  it('returns vertical_drama ladder with VD-specific types', () => {
    const ladder = getLaneLadder('vertical_drama');
    expect(ladder).toContain('vertical_episode_beats');
    expect(ladder).toContain('format_rules');
    expect(ladder).toContain('season_arc');
    expect(ladder).toContain('episode_grid');
    expect(ladder).not.toContain('blueprint');
  });

  it('returns documentary ladder', () => {
    const ladder = getLaneLadder('documentary');
    expect(ladder).toContain('documentary_outline');
    expect(ladder).not.toContain('beat_sheet');
  });

  it('falls back to unspecified for unknown lane', () => {
    expect(getLaneLadder('totally_unknown')).toEqual(LANE_DOC_LADDERS.unspecified);
  });

  it('falls back to unspecified for null', () => {
    expect(getLaneLadder(null)).toEqual(LANE_DOC_LADDERS.unspecified);
  });
});

describe('isDocTypeAllowedInLane', () => {
  it('blueprint allowed in feature_film', () => {
    expect(isDocTypeAllowedInLane('feature_film', 'blueprint')).toBe(true);
  });

  it('blueprint NOT allowed in vertical_drama', () => {
    expect(isDocTypeAllowedInLane('vertical_drama', 'blueprint')).toBe(false);
  });

  it('format_rules allowed in vertical_drama', () => {
    expect(isDocTypeAllowedInLane('vertical_drama', 'format_rules')).toBe(true);
  });

  it('normalizes legacy alias before checking: "treatment" allowed in feature_film (→ blueprint)', () => {
    expect(isDocTypeAllowedInLane('feature_film', 'treatment')).toBe(true);
  });

  it('normalizes "treatment" → blueprint, NOT in vertical_drama', () => {
    expect(isDocTypeAllowedInLane('vertical_drama', 'treatment')).toBe(false);
  });

  it('documentary_outline allowed in documentary', () => {
    expect(isDocTypeAllowedInLane('documentary', 'documentary_outline')).toBe(true);
  });

  it('feature_script not in documentary', () => {
    expect(isDocTypeAllowedInLane('documentary', 'feature_script')).toBe(false);
  });
});

describe('formatToLane', () => {
  it('film → feature_film', () => {
    expect(formatToLane('film')).toBe('feature_film');
  });

  it('tv-series → series', () => {
    expect(formatToLane('tv-series')).toBe('series');
  });

  it('vertical-drama → vertical_drama', () => {
    expect(formatToLane('vertical-drama')).toBe('vertical_drama');
  });

  it('documentary → documentary', () => {
    expect(formatToLane('documentary')).toBe('documentary');
  });

  it('unknown → unspecified', () => {
    expect(formatToLane('weird')).toBe('unspecified');
  });

  it('null → unspecified', () => {
    expect(formatToLane(null)).toBe('unspecified');
  });
});

describe('alias completeness', () => {
  it('all aliases resolve to keys that exist in BASE_DOC_TYPES', () => {
    for (const [alias, canonical] of Object.entries(DOC_LABEL_ALIASES)) {
      expect(
        BASE_DOC_TYPES[canonical] !== undefined,
        `Alias "${alias}" → "${canonical}" but "${canonical}" not in BASE_DOC_TYPES`
      ).toBe(true);
    }
  });
});
