/**
 * Trailer clip quality gate constants (FE mirror of BE attemptPolicy.ts).
 * Used for UI display logic — the authoritative retry decisions happen BE-side.
 */

export const PASS_THRESHOLD = 0.75;
export const MAX_ATTEMPTS = 3;

export const FAILURE_ESCALATE_SET = new Set([
  "FLATLINE",
  "LOW_CONTRAST",
  "NO_ESCALATION",
  "PACING_MISMATCH",
  "TONAL_WHIPLASH",
  "ENERGY_DROP",
]);
