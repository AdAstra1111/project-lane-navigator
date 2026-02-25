/**
 * validateAndClamp — Lane-aware pacing validation and clamping.
 *
 * Ensures beats_per_minute values are sensible for the given lane,
 * fills defaults when missing, and produces human-readable warnings
 * when clamping occurs.
 */
import type { EngineProfile, Lane } from './types';
import { getDefaultEngineProfile } from './defaults';

export interface PacingClamps {
  min: { floor: number; ceiling: number };
  target: { floor: number; ceiling: number };
  max: { floor: number; ceiling: number };
}

const LANE_CLAMPS: Record<string, PacingClamps> = {
  vertical_drama: {
    min:    { floor: 2,   ceiling: 5 },
    target: { floor: 3,   ceiling: 5 },
    max:    { floor: 4,   ceiling: 7 },
  },
  feature_film: {
    min:    { floor: 0.5, ceiling: 3 },
    target: { floor: 1.5, ceiling: 3.5 },
    max:    { floor: 2,   ceiling: 6 },
  },
  series: {
    min:    { floor: 1,   ceiling: 4 },
    target: { floor: 2,   ceiling: 4 },
    max:    { floor: 3,   ceiling: 6 },
  },
  documentary: {
    min:    { floor: 0.5, ceiling: 2 },
    target: { floor: 1,   ceiling: 2.5 },
    max:    { floor: 1.5, ceiling: 4 },
  },
};

function clampValue(value: number, floor: number, ceiling: number): number {
  return Math.max(floor, Math.min(ceiling, value));
}

export interface ClampResult {
  rules: EngineProfile;
  warnings: string[];
}

export function getLaneClamps(lane: string): PacingClamps {
  return LANE_CLAMPS[lane] || LANE_CLAMPS.feature_film;
}

export function getLaneDefaults(lane: string): { min: number; target: number; max: number } {
  const defaults = getDefaultEngineProfile(lane as Lane);
  return { ...defaults.pacing_profile.beats_per_minute };
}

export function validateAndClamp(
  rules: EngineProfile,
  lane: string,
  /** If true, skip lane-specific clamping but still enforce min<=target<=max */
  bypassLaneClamps = false,
): ClampResult {
  const warnings: string[] = [];
  const result = JSON.parse(JSON.stringify(rules)) as EngineProfile;

  // Ensure pacing_profile exists
  if (!result.pacing_profile) {
    const defaults = getDefaultEngineProfile(lane as Lane);
    result.pacing_profile = { ...defaults.pacing_profile };
    warnings.push('Pacing profile was missing; filled with lane defaults.');
  }

  // Ensure beats_per_minute exists
  if (!result.pacing_profile.beats_per_minute) {
    const defaults = getDefaultEngineProfile(lane as Lane);
    result.pacing_profile.beats_per_minute = { ...defaults.pacing_profile.beats_per_minute };
    warnings.push('Beats per minute was missing; filled with lane defaults.');
  }

  const bpm = result.pacing_profile.beats_per_minute;
  const original = { min: bpm.min, target: bpm.target, max: bpm.max };

  if (!bypassLaneClamps) {
    const clamps = getLaneClamps(lane);

    // Clamp each value
    bpm.min = clampValue(bpm.min, clamps.min.floor, clamps.min.ceiling);
    bpm.target = clampValue(bpm.target, clamps.target.floor, clamps.target.ceiling);
    bpm.max = clampValue(bpm.max, clamps.max.floor, clamps.max.ceiling);

    // Generate warnings for each clamped value
    if (original.min !== bpm.min) {
      warnings.push(`Pacing min clamped: ${original.min} → ${bpm.min} BPM (${lane} range: ${clamps.min.floor}–${clamps.min.ceiling}).`);
    }
    if (original.target !== bpm.target) {
      warnings.push(`Pacing target clamped: ${original.target} → ${bpm.target} BPM (${lane} range: ${clamps.target.floor}–${clamps.target.ceiling}).`);
    }
    if (original.max !== bpm.max) {
      warnings.push(`Pacing max clamped: ${original.max} → ${bpm.max} BPM (${lane} range: ${clamps.max.floor}–${clamps.max.ceiling}).`);
    }
  }

  // Enforce min <= target <= max invariant
  if (bpm.min > bpm.target) {
    bpm.min = bpm.target;
    warnings.push(`Pacing min adjusted to ${bpm.min} to maintain min ≤ target.`);
  }
  if (bpm.target > bpm.max) {
    bpm.max = bpm.target;
    warnings.push(`Pacing max adjusted to ${bpm.max} to maintain target ≤ max.`);
  }

  result.pacing_profile.beats_per_minute = bpm;
  return { rules: result, warnings };
}
