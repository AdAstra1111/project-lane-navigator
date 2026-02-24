/**
 * Cinematic Intelligence Kernel — Type definitions
 * Pure types, no runtime logic.
 */

export type CinematicIntent =
  | "intrigue"
  | "threat"
  | "wonder"
  | "chaos"
  | "emotion"
  | "release";

export interface CinematicUnit {
  id: string;
  intent: CinematicIntent;
  /** 0..1 */
  energy: number;
  /** 0..1 */
  tension: number;
  /** 0..1 */
  density: number;
  /** -1..1 */
  tonal_polarity: number;
}

export type CinematicFailureCode =
  | "TOO_SHORT"
  | "NO_PEAK"
  | "NO_ESCALATION"
  | "FLATLINE"
  | "LOW_CONTRAST"
  | "TONAL_WHIPLASH"
  | "WEAK_ARC"
  | "LOW_INTENT_DIVERSITY"
  | "PACING_MISMATCH"
  | "ENERGY_DROP"
  | "DIRECTION_REVERSAL"
  | "EYE_LINE_BREAK";

/** Codes that are diagnostic-only (do not block pass by themselves). */
export const DIAGNOSTIC_ONLY_CODES: ReadonlySet<CinematicFailureCode> = new Set(["EYE_LINE_BREAK"]);

export interface PenaltyEntry {
  code: CinematicFailureCode;
  magnitude: number;
}

export interface CinematicMetrics {
  unit_count: number;
  peak_energy: number;
  escalation_slope: number;
  contrast_index: number;
  coherence_index: number;
  flatline_spans: number;
  tonal_flip_count: number;
}

export interface CinematicScore {
  pass: boolean;
  /** 0..1 */
  score: number;
  failures: CinematicFailureCode[];
  /** Hard failures that block pass. */
  hard_failures: CinematicFailureCode[];
  /** Diagnostic-only flags (inform penalties/telemetry, don't block pass alone). */
  diagnostic_flags: CinematicFailureCode[];
  /** Per-code penalty breakdown for telemetry. */
  penalty_breakdown: PenaltyEntry[];
  metrics: CinematicMetrics;
}
