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

/* ── normalizeDocType (global, no lane) ── */

describe('normalizeDocType (global)', () => {
  it('lowercases and underscores', () => {
    expect(normalizeDocType('Beat Sheet')).toBe('beat_sheet');
  });

  it('resolves "Blueprint" to treatment', () => {
    expect(normalizeDocType('Blueprint')).toBe('treatment');
  });

  it('resolves "Architecture" to story_outline', () => {
    expect(normalizeDocType('Architecture')).toBe('story_outline');
  });

  it('resolves "treatment" to treatment (identity)', () => {
    expect(normalizeDocType('treatment')).toBe('treatment');
  });

  it('resolves "Series Bible" to treatment', () => {
    expect(normalizeDocType('Series Bible')).toBe('treatment');
  });

  it('resolves "plot_architecture" to story_outline', () => {
    expect(normalizeDocType('plot_architecture')).toBe('story_outline');
  });

  it('resolves "script" to feature_script', () => {
    expect(normalizeDocType('script')).toBe('feature_script');
  });

  it('resolves "draft" to feature_script', () => {
    expect(normalizeDocType('draft')).toBe('feature_script');
  });

  it('passes through unknown types unchanged', () => {
    expect(normalizeDocType('my_custom_doc')).toBe('my_custom_doc');
  });

  it('handles empty string', () => {
    expect(normalizeDocType('')).toBe('');
  });
});

/* ── normalizeDocType (lane-aware episode_beats fix) ── */

describe('normalizeDocType (lane-aware)', () => {
  it('episode_beats in series lane stays as episode_beats', () => {
    expect(normalizeDocType('episode_beats', 'series')).toBe('episode_beats');
  });

  it('episode_beats in vertical_drama lane → vertical_episode_beats', () => {
    expect(normalizeDocType('episode_beats', 'vertical_drama')).toBe('vertical_episode_beats');
  });

  it('episode_beats in feature_film lane stays as episode_beats', () => {
    expect(normalizeDocType('episode_beats', 'feature_film')).toBe('episode_beats');
  });

  it('episode_beats with no lane stays as episode_beats (no global alias)', () => {
    expect(normalizeDocType('episode_beats')).toBe('episode_beats');
  });

  it('episode-beats with hyphens in vertical_drama → vertical_episode_beats', () => {
    expect(normalizeDocType('episode-beats', 'vertical_drama')).toBe('vertical_episode_beats');
  });

  it('episode-beats with hyphens in series stays as episode_beats', () => {
    expect(normalizeDocType('episode-beats', 'series')).toBe('episode_beats');
  });

  it('Blueprint resolves to treatment regardless of lane', () => {
    expect(normalizeDocType('Blueprint', 'feature_film')).toBe('treatment');
    expect(normalizeDocType('Blueprint', 'series')).toBe('treatment');
    expect(normalizeDocType('Blueprint', 'vertical_drama')).toBe('treatment');
  });

  it('format parameter works when lane is null', () => {
    expect(normalizeDocType('episode_beats', null, 'vertical-drama')).toBe('vertical_episode_beats');
    expect(normalizeDocType('episode_beats', null, 'tv-series')).toBe('episode_beats');
  });
});

/* ── getLaneLadder ── */

describe('getLaneLadder', () => {
  it('returns feature_film ladder with treatment + story_outline', () => {
    const ladder = getLaneLadder('feature_film');
    expect(ladder).toContain('treatment');
    expect(ladder).toContain('story_outline');
    expect(ladder).toContain('feature_script');
    expect(ladder).not.toContain('blueprint');
    expect(ladder).not.toContain('architecture');
    expect(ladder).not.toContain('episode_grid');
  });

  it('returns vertical_drama ladder with VD-specific types', () => {
    const ladder = getLaneLadder('vertical_drama');
    expect(ladder).toContain('vertical_episode_beats');
    expect(ladder).toContain('format_rules');
    expect(ladder).toContain('season_arc');
    expect(ladder).toContain('episode_grid');
    expect(ladder).not.toContain('treatment');
    expect(ladder).not.toContain('blueprint');
  });

  it('returns series ladder with episode_beats', () => {
    const ladder = getLaneLadder('series');
    expect(ladder).toContain('episode_beats');
    expect(ladder).toContain('treatment');
    expect(ladder).not.toContain('vertical_episode_beats');
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

  it('no ladder contains blueprint or architecture', () => {
    for (const [lane, ladder] of Object.entries(LANE_DOC_LADDERS)) {
      expect(ladder, `${lane} contains blueprint`).not.toContain('blueprint');
      expect(ladder, `${lane} contains architecture`).not.toContain('architecture');
    }
  });
});

/* ── isDocTypeAllowedInLane ── */

describe('isDocTypeAllowedInLane', () => {
  it('"treatment" allowed in feature_film', () => {
    expect(isDocTypeAllowedInLane('feature_film', 'treatment')).toBe(true);
  });

  it('"Blueprint" (legacy) allowed in feature_film (aliases to treatment)', () => {
    expect(isDocTypeAllowedInLane('feature_film', 'Blueprint')).toBe(true);
  });

  it('"treatment" NOT allowed in vertical_drama', () => {
    expect(isDocTypeAllowedInLane('vertical_drama', 'treatment')).toBe(false);
  });

  it('format_rules allowed in vertical_drama', () => {
    expect(isDocTypeAllowedInLane('vertical_drama', 'format_rules')).toBe(true);
  });

  it('documentary_outline allowed in documentary', () => {
    expect(isDocTypeAllowedInLane('documentary', 'documentary_outline')).toBe(true);
  });

  it('feature_script not in documentary', () => {
    expect(isDocTypeAllowedInLane('documentary', 'feature_script')).toBe(false);
  });

  it('episode_beats allowed in series but not in feature_film', () => {
    expect(isDocTypeAllowedInLane('series', 'episode_beats')).toBe(true);
    expect(isDocTypeAllowedInLane('feature_film', 'episode_beats')).toBe(false);
  });
});

/* ── formatToLane ── */

describe('formatToLane', () => {
  it('film → feature_film', () => expect(formatToLane('film')).toBe('feature_film'));
  it('tv-series → series', () => expect(formatToLane('tv-series')).toBe('series'));
  it('vertical-drama → vertical_drama', () => expect(formatToLane('vertical-drama')).toBe('vertical_drama'));
  it('documentary → documentary', () => expect(formatToLane('documentary')).toBe('documentary'));
  it('unknown → unspecified', () => expect(formatToLane('weird')).toBe('unspecified'));
  it('null → unspecified', () => expect(formatToLane(null)).toBe('unspecified'));
});

/* ── alias completeness ── */

describe('alias completeness', () => {
  it('all global aliases resolve to keys in BASE_DOC_TYPES', () => {
    for (const [alias, canonical] of Object.entries(DOC_LABEL_ALIASES)) {
      expect(
        BASE_DOC_TYPES[canonical] !== undefined,
        `Alias "${alias}" → "${canonical}" but "${canonical}" not in BASE_DOC_TYPES`
      ).toBe(true);
    }
  });

  it('blueprint and architecture are NOT canonical keys', () => {
    expect(BASE_DOC_TYPES).not.toHaveProperty('blueprint');
    expect(BASE_DOC_TYPES).not.toHaveProperty('architecture');
  });

  it('blueprint aliases to treatment', () => {
    expect(DOC_LABEL_ALIASES['blueprint']).toBe('treatment');
  });

  it('architecture aliases to story_outline', () => {
    expect(DOC_LABEL_ALIASES['architecture']).toBe('story_outline');
  });
});
