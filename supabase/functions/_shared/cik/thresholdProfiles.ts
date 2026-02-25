/**
 * CIK — Product-Lane Threshold Profiles
 * Deterministic threshold overrides per product lane.
 * No new failure codes; only numeric adjustments.
 */
import { CINEMATIC_THRESHOLDS } from "../cinematic-score.ts";
import { applyStrictness, parseStrictnessMode, type StrictnessMode } from "./strictness.ts";

/** Mutable version of the threshold shape (the source uses `as const` literals). */
export type CinematicThresholds = { -readonly [K in keyof typeof CINEMATIC_THRESHOLDS]: number };

export type ProductLane = "feature_film" | "series" | "vertical_drama" | "documentary" | "advertising" | "music_video";

const KNOWN_LANES: ReadonlySet<string> = new Set<ProductLane>([
  "feature_film", "series", "vertical_drama", "documentary", "advertising", "music_video",
]);

/**
 * Lane-specific overrides (shallow merge on top of defaults).
 * Only fields that differ from feature_film baseline are listed.
 */
const LANE_OVERRIDES: Record<ProductLane, Partial<CinematicThresholds>> = {
  feature_film: {},

  series: {
    min_arc_peak_in_last_n: 3,
    min_arc_mid_energy: 0.50,
  },

  vertical_drama: {
    min_units: 3,
    min_slope: 0.03,
    min_peak_energy: 0.90,
    energy_drop_threshold: 0.10,
  },

  documentary: {
    min_contrast: 0.40,
    max_tonal_flips: 3,
    penalty_low_contrast: 0.06,
    penalty_tonal_whiplash: 0.06,
    min_arc_end_energy: 0.65,
    max_direction_reversals: 4,
  },

  advertising: {
    min_units: 3,
    min_slope: 0.04,
    min_peak_energy: 0.92,
    energy_drop_threshold: 0.08,
    penalty_energy_drop: 0.12,
  },

  music_video: {
    min_intent_distinct: 2,
    max_tonal_flips: 4,
    penalty_tonal_whiplash: 0.04,
    penalty_low_intent_diversity: 0.04,
    min_arc_mid_energy: 0.45,
    min_arc_end_energy: 0.60,
    max_direction_reversals: 5,
  },
};

/**
 * Returns the threshold profile for a given product lane + optional strictness mode.
 * Unknown/missing lane returns exact defaults (feature_film baseline).
 * Standard strictness returns lane thresholds unchanged (identity).
 */
export function getCinematicThresholds(lane?: string, strictness?: StrictnessMode | string): CinematicThresholds {
  let base: CinematicThresholds;
  if (!lane || !KNOWN_LANES.has(lane)) {
    base = { ...CINEMATIC_THRESHOLDS };
  } else {
    const overrides = LANE_OVERRIDES[lane as ProductLane];
    base = { ...CINEMATIC_THRESHOLDS, ...overrides };
  }
  const mode = parseStrictnessMode(strictness);
  return applyStrictness(base, mode);
}
