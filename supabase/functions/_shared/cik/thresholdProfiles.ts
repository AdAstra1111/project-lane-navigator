/**
 * CIK — Product-Lane Threshold Profiles
 * Deterministic threshold overrides per product lane.
 * No new failure codes; only numeric adjustments.
 */
import { CINEMATIC_THRESHOLDS } from "../cinematic-score.ts";

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
    // Tighter late-peak: peak must be in last 3 units (series episodes need stronger cliffhangers)
    min_arc_peak_in_last_n: 3,
    // Slightly lower mid-arc bar (series can have slower mid-episode builds)
    min_arc_mid_energy: 0.50,
  },

  vertical_drama: {
    // Shorter content allowed
    min_units: 3,
    // Must escalate faster
    min_slope: 0.03,
    // Higher peak requirement (short-form needs immediate impact)
    min_peak_energy: 0.90,
    // Tighter energy drop (no room for fades in short form)
    energy_drop_threshold: 0.10,
  },

  documentary: {
    // Lower contrast bar (docs can be more contemplative)
    min_contrast: 0.40,
    // Relax tonal whiplash (docs naturally shift tone more)
    max_tonal_flips: 3,
    // Lower penalty for contrast issues
    penalty_low_contrast: 0.06,
    // Lower penalty for tonal whiplash
    penalty_tonal_whiplash: 0.06,
    // Lower arc end energy (docs don't always end at peak intensity)
    min_arc_end_energy: 0.65,
    // Allow more direction reversals (docs have natural ebb and flow)
    max_direction_reversals: 4,
  },

  advertising: {
    // Short form, strict peak
    min_units: 3,
    min_slope: 0.04,
    min_peak_energy: 0.92,
    energy_drop_threshold: 0.08,
    // Tight tail
    penalty_energy_drop: 0.12,
  },

  music_video: {
    // Relaxed intent and tonal rules
    min_intent_distinct: 2,
    max_tonal_flips: 4,
    penalty_tonal_whiplash: 0.04,
    penalty_low_intent_diversity: 0.04,
    // Lower arc requirements
    min_arc_mid_energy: 0.45,
    min_arc_end_energy: 0.60,
    max_direction_reversals: 5,
  },
};

/**
 * Returns the threshold profile for a given product lane.
 * Unknown/missing lane returns exact defaults (feature_film baseline).
 */
export function getCinematicThresholds(lane?: string): CinematicThresholds {
  if (!lane || !KNOWN_LANES.has(lane)) {
    return { ...CINEMATIC_THRESHOLDS };
  }
  const overrides = LANE_OVERRIDES[lane as ProductLane];
  return { ...CINEMATIC_THRESHOLDS, ...overrides };
}
