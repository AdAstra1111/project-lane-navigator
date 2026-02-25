/**
 * CIK v5.0 — Strictness Mode
 * Deterministic threshold multipliers for lenient / standard / strict modes.
 * No new failure codes. No extra LLM passes.
 */

export type StrictnessMode = "lenient" | "standard" | "strict";

export const STRICTNESS_MODES: readonly StrictnessMode[] = ["lenient", "standard", "strict"] as const;

/**
 * Multiplier profiles per strictness mode.
 * Applied to lane-resolved thresholds AFTER lane overrides.
 * 
 * For "harder" thresholds (min_peak_energy, min_slope, min_contrast, etc.):
 *   lenient multiplies DOWN (easier), strict multiplies UP (harder).
 * For "softer" thresholds (max_tonal_flips, max_direction_reversals, flatline_span):
 *   lenient multiplies UP (more forgiving), strict multiplies DOWN (tighter).
 * Penalty magnitudes are NOT adjusted (scoring severity stays constant).
 */

/** Fields where HIGHER = HARDER (multiply up for strict, down for lenient) */
const HARDER_FIELDS = new Set([
  "min_peak_energy", "min_slope", "min_contrast",
  "min_intent_distinct", "min_arc_end_energy", "min_arc_mid_energy",
]);

/** Fields where HIGHER = EASIER (multiply up for lenient, down for strict) */
const EASIER_FIELDS = new Set([
  "max_tonal_flips", "max_direction_reversals", "flatline_span",
  "max_early_peak_energy",
]);

/** Fields that are penalties — NOT adjusted by strictness */
const PENALTY_FIELDS = new Set([
  "penalty_too_short", "penalty_no_peak", "penalty_no_escalation",
  "penalty_flatline", "penalty_low_contrast", "penalty_tonal_whiplash",
  "penalty_low_intent_diversity", "penalty_weak_arc", "penalty_pacing_mismatch",
  "penalty_energy_drop", "penalty_direction_reversal", "penalty_eye_line_break",
]);

/** Fields that are counts/indices — kept as integers after rounding */
const INTEGER_FIELDS = new Set([
  "min_units", "flatline_span", "max_tonal_flips",
  "min_intent_distinct", "min_arc_peak_in_last_n", "max_direction_reversals",
]);

// Multiplier constants — deliberately small adjustments
const LENIENT_HARDER_MUL = 0.92;   // lower bar for "harder" thresholds
const LENIENT_EASIER_MUL = 1.15;   // more forgiving for "easier" thresholds
const STRICT_HARDER_MUL = 1.08;    // raise bar for "harder" thresholds  
const STRICT_EASIER_MUL = 0.85;    // tighter for "easier" thresholds

/** Clamp ranges for specific fields after multiplier application */
const FIELD_CLAMPS: Record<string, [number, number]> = {
  min_peak_energy: [0.50, 0.99],
  min_slope: [0.005, 0.10],
  min_contrast: [0.20, 0.90],
  min_arc_end_energy: [0.40, 0.99],
  min_arc_mid_energy: [0.30, 0.90],
  max_early_peak_energy: [0.50, 0.95],
  min_intent_distinct: [1, 6],
  min_units: [2, 8],
  flatline_span: [2, 6],
  max_tonal_flips: [1, 6],
  max_direction_reversals: [1, 8],
  energy_drop_threshold: [0.05, 0.30],
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Parse and validate a strictness mode string. Returns "standard" for unknown values.
 */
export function parseStrictnessMode(mode?: string | null): StrictnessMode {
  if (mode === "lenient" || mode === "strict") return mode;
  return "standard";
}

/**
 * Apply strictness multipliers to a threshold object.
 * Returns a new object — does not mutate the input.
 * Standard mode returns the input unchanged (identity operation).
 */
export function applyStrictness<T extends Record<string, number>>(
  thresholds: T,
  mode: StrictnessMode,
): T {
  if (mode === "standard") return thresholds;

  const result = { ...thresholds };

  for (const key of Object.keys(result)) {
    // Never adjust penalties
    if (PENALTY_FIELDS.has(key)) continue;

    const base = result[key as keyof T] as number;
    let adjusted: number;

    if (HARDER_FIELDS.has(key)) {
      // Higher = harder to pass
      adjusted = base * (mode === "lenient" ? LENIENT_HARDER_MUL : STRICT_HARDER_MUL);
    } else if (EASIER_FIELDS.has(key)) {
      // Higher = easier to pass
      adjusted = base * (mode === "lenient" ? LENIENT_EASIER_MUL : STRICT_EASIER_MUL);
    } else {
      // Neutral fields (energy_drop_threshold, min_arc_peak_in_last_n, etc.)
      // Apply a mild adjustment
      if (key === "energy_drop_threshold") {
        // Higher threshold = easier (more drop allowed)
        adjusted = base * (mode === "lenient" ? 1.10 : 0.90);
      } else {
        adjusted = base; // No change for unclassified fields
      }
    }

    // Apply clamp if defined
    const clampRange = FIELD_CLAMPS[key];
    if (clampRange) {
      adjusted = clamp(adjusted, clampRange[0], clampRange[1]);
    }

    // Round integers
    if (INTEGER_FIELDS.has(key)) {
      adjusted = Math.round(adjusted);
    }

    (result as any)[key] = adjusted;
  }

  return result;
}
