/**
 * Canonical production type normalization for trends.
 * Shared across refresh-trends, backfill, and coverage-audit.
 *
 * SINGLE SOURCE OF TRUTH for what production_type values are valid in trend tables.
 */

export const REQUIRED_TREND_TYPES = [
  "film",
  "tv-series",
  "vertical-drama",
  "animation",
] as const;

export const CANONICAL_TREND_TYPES = [
  "film",
  "tv-series",
  "vertical-drama",
  "animation",
  "documentary",
  "documentary-series",
  "commercial",
  "branded-content",
  "music-video",
  "short-film",
  "digital-series",
  "hybrid",
  "proof-of-concept",
] as const;

const ALIAS_MAP: Record<string, string> = {
  // Common AI model outputs that need normalizing
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

/**
 * Normalize a production_type value to canonical form.
 * 1. If raw matches a canonical type exactly, return it.
 * 2. If raw matches an alias, return the canonical form.
 * 3. If requestedType is provided, return it as fallback (the type we asked the model to generate for).
 * 4. Otherwise return "film" as safe default.
 */
export function normalizeProductionType(
  raw: string | null | undefined,
  requestedType?: string | null,
): string {
  if (!raw) return requestedType || "film";

  const lower = raw.toLowerCase().trim().replace(/_/g, "-");

  // Exact match to canonical
  if ((CANONICAL_TREND_TYPES as readonly string[]).includes(lower)) {
    return lower;
  }

  // Alias lookup
  const alias = ALIAS_MAP[lower];
  if (alias) return alias;

  // Fallback to requested type
  if (requestedType) return requestedType;

  return "film";
}
