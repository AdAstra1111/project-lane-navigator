/**
 * Character Pressure Matrix v1 — Frontend flag mirror
 * Mirrors the backend feature flag for UI gating.
 */

export const CHARACTER_PRESSURE_MATRIX_V1 = false;

export const CP_FIELDS = [
  "pressure_source",
  "internal_dilemma",
  "relationship_shift",
  "micro_transformation",
  "cliffhanger_cause",
] as const;

export type CPField = typeof CP_FIELDS[number];
