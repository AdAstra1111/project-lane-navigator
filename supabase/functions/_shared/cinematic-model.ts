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
  | "LOW_INTENT_DIVERSITY";

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
  metrics: CinematicMetrics;
}
