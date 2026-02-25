/**
 * CIK — Tuning Hooks
 * Optional per-lane multiplier overrides for thresholds.
 * No runtime changes when tuning is not set.
 */

export interface TuningOverrides {
  peakLeadThresholdMul?: number;
  tailSlackMul?: number;
  lateStartRatioOverride?: number;
  minContrastOverride?: number;
}

/**
 * In-memory tuning registry.
 * Keys are lane names (e.g. "vertical_drama").
 * Values are partial overrides that scale existing thresholds.
 */
const tuningRegistry = new Map<string, TuningOverrides>();

/** Set tuning overrides for a lane. Merges with existing. */
export function setTuning(lane: string, overrides: TuningOverrides): void {
  const existing = tuningRegistry.get(lane) || {};
  tuningRegistry.set(lane, { ...existing, ...overrides });
}

/** Clear all tuning overrides. */
export function clearTuning(): void {
  tuningRegistry.clear();
}

/** Clear tuning for a specific lane. */
export function clearLaneTuning(lane: string): void {
  tuningRegistry.delete(lane);
}

/** Get tuning overrides for a lane. Returns undefined if none set. */
export function getTuning(lane: string): TuningOverrides | undefined {
  return tuningRegistry.get(lane);
}

/**
 * Apply tuning to a numeric value.
 * If a multiplier override exists, applies it. Otherwise returns original.
 */
export function applyTuningMul(
  baseValue: number,
  lane: string | undefined,
  field: keyof TuningOverrides,
): number {
  if (!lane) return baseValue;
  const t = tuningRegistry.get(lane);
  if (!t) return baseValue;
  const mul = t[field];
  if (mul == null) return baseValue;
  // For "override" fields, replace rather than multiply
  if (field === "lateStartRatioOverride" || field === "minContrastOverride") {
    return mul;
  }
  return baseValue * mul;
}
