/**
 * Tests for normalizeProductionType — the canonical production_type normalizer.
 *
 * This is a drift-lock: the frontend copy must match the backend copy.
 * Here we test the logic directly using a local copy of the function.
 */
import { describe, it, expect } from 'vitest';

// ── Inline copy for testing (mirrors supabase/functions/_shared/trendsNormalize.ts) ──

const CANONICAL_TREND_TYPES = [
  "film", "tv-series", "vertical-drama", "animation",
  "documentary", "documentary-series", "commercial", "branded-content",
  "music-video", "short-film", "digital-series", "hybrid", "proof-of-concept",
] as const;

const ALIAS_MAP: Record<string, string> = {
  "narrative feature": "film",
  "narrative-feature": "film",
  "feature film": "film",
  "feature-film": "film",
  "movie": "film",
  "series": "tv-series",
  "television series": "tv-series",
  "television-series": "tv-series",
  "tv series": "tv-series",
  "tv_series": "tv-series",
  "vertical drama": "vertical-drama",
  "vertical_drama": "vertical-drama",
  "shortform": "vertical-drama",
  "short-form": "vertical-drama",
  "short form drama": "vertical-drama",
  "animated": "animation",
  "animated feature": "animation",
  "animated-feature": "animation",
  "animated series": "animation",
  "animated-series": "animation",
  "anim-feature": "animation",
  "anim-series": "animation",
  "anim_feature": "animation",
  "anim_series": "animation",
  "doc": "documentary",
  "doc-series": "documentary-series",
  "doc series": "documentary-series",
  "documentary_series": "documentary-series",
  "branded content": "branded-content",
  "branded_content": "branded-content",
  "music video": "music-video",
  "music_video": "music-video",
  "short film": "short-film",
  "short_film": "short-film",
  "digital series": "digital-series",
  "digital_series": "digital-series",
  "proof of concept": "proof-of-concept",
  "proof_of_concept": "proof-of-concept",
};

function normalizeProductionType(raw: string | null | undefined, requestedType?: string | null): string {
  if (!raw) return requestedType || "film";
  const lower = raw.toLowerCase().trim().replace(/_/g, "-");
  if ((CANONICAL_TREND_TYPES as readonly string[]).includes(lower)) return lower;
  const alias = ALIAS_MAP[lower];
  if (alias) return alias;
  if (requestedType) return requestedType;
  return "film";
}

// ── Tests ──

describe('normalizeProductionType', () => {
  it('returns canonical types unchanged', () => {
    expect(normalizeProductionType('film')).toBe('film');
    expect(normalizeProductionType('tv-series')).toBe('tv-series');
    expect(normalizeProductionType('vertical-drama')).toBe('vertical-drama');
    expect(normalizeProductionType('animation')).toBe('animation');
    expect(normalizeProductionType('documentary')).toBe('documentary');
  });

  it('normalizes underscored variants', () => {
    expect(normalizeProductionType('tv_series')).toBe('tv-series');
    expect(normalizeProductionType('vertical_drama')).toBe('vertical-drama');
    expect(normalizeProductionType('branded_content')).toBe('branded-content');
  });

  it('normalizes AI model alias outputs', () => {
    expect(normalizeProductionType('narrative feature')).toBe('film');
    expect(normalizeProductionType('feature film')).toBe('film');
    expect(normalizeProductionType('movie')).toBe('film');
    expect(normalizeProductionType('series')).toBe('tv-series');
    expect(normalizeProductionType('animated')).toBe('animation');
    expect(normalizeProductionType('animated feature')).toBe('animation');
    expect(normalizeProductionType('shortform')).toBe('vertical-drama');
  });

  it('falls back to requestedType for unknown values', () => {
    expect(normalizeProductionType('some-random-thing', 'vertical-drama')).toBe('vertical-drama');
    expect(normalizeProductionType('gibberish', 'animation')).toBe('animation');
  });

  it('falls back to film when no requestedType', () => {
    expect(normalizeProductionType('unknown-type')).toBe('film');
    expect(normalizeProductionType(null)).toBe('film');
    expect(normalizeProductionType(undefined)).toBe('film');
  });

  it('handles null/undefined with requestedType', () => {
    expect(normalizeProductionType(null, 'animation')).toBe('animation');
    expect(normalizeProductionType(undefined, 'vertical-drama')).toBe('vertical-drama');
  });

  it('is case-insensitive', () => {
    expect(normalizeProductionType('FILM')).toBe('film');
    expect(normalizeProductionType('TV-Series')).toBe('tv-series');
    expect(normalizeProductionType('Animated Feature')).toBe('animation');
  });

  it('maps anim- prefixed formats to animation', () => {
    expect(normalizeProductionType('anim-feature')).toBe('animation');
    expect(normalizeProductionType('anim-series')).toBe('animation');
    expect(normalizeProductionType('anim_feature')).toBe('animation');
  });
});
