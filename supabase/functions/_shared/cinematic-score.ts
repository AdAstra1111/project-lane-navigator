/**
 * Cinematic Intelligence Kernel — Deterministic scoring
 * Pure math, no LLM calls.
 */
import type { CinematicUnit, CinematicScore, CinematicFailureCode, CinematicMetrics } from "./cinematic-model.ts";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

/**
 * Count runs of consecutive energy deltas below eps.
 * Returns the length of the longest such run.
 */
function longestFlatlineSpan(units: CinematicUnit[], eps = 0.03): number {
  if (units.length < 2) return 0;
  let maxSpan = 0;
  let currentSpan = 0;
  for (let i = 1; i < units.length; i++) {
    if (Math.abs(units[i].energy - units[i - 1].energy) < eps) {
      currentSpan++;
      maxSpan = Math.max(maxSpan, currentSpan);
    } else {
      currentSpan = 0;
    }
  }
  return maxSpan;
}

/** Count sign-flips in tonal_polarity (crossing zero). */
function tonalFlipCount(units: CinematicUnit[]): number {
  let flips = 0;
  for (let i = 1; i < units.length; i++) {
    const prev = units[i - 1].tonal_polarity;
    const curr = units[i].tonal_polarity;
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) flips++;
  }
  return flips;
}

/** Simple linear regression slope of energy over unit index. */
function escalationSlope(units: CinematicUnit[]): number {
  const n = units.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += units[i].energy;
    sumXY += i * units[i].energy;
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * scoreCinematic — Deterministic quality gate for cinematic unit sequences.
 *
 * Hard failures:
 *   TOO_SHORT       units < 4
 *   NO_PEAK         peak energy < 0.85
 *   NO_ESCALATION   overall slope <= 0.01
 *   FLATLINE        any flatline span >= 3
 *   LOW_CONTRAST    contrast_index < 0.55
 *   TONAL_WHIPLASH  tonal flips >= 2
 */
export function scoreCinematic(units: CinematicUnit[]): CinematicScore {
  const failures: CinematicFailureCode[] = [];

  const n = units.length;
  const energies = units.map(u => u.energy);
  const peakEnergy = energies.length > 0 ? Math.max(...energies) : 0;
  const slope = escalationSlope(units);
  const flatSpan = longestFlatlineSpan(units);
  const flips = tonalFlipCount(units);

  // Contrast index: sqrt of energy variance, scaled to 0..1
  const contrastIndex = clamp(Math.sqrt(variance(energies)) * 3, 0, 1);

  // Coherence index: average of adjacent-pair tension correlation
  let coherenceSum = 0;
  if (n >= 2) {
    for (let i = 1; i < n; i++) {
      const tensionDelta = Math.abs(units[i].tension - units[i - 1].tension);
      const energyDelta = Math.abs(units[i].energy - units[i - 1].energy);
      coherenceSum += 1 - Math.abs(tensionDelta - energyDelta);
    }
  }
  const coherenceIndex = n >= 2 ? clamp(coherenceSum / (n - 1), 0, 1) : 1;

  const metrics: CinematicMetrics = {
    unit_count: n,
    peak_energy: peakEnergy,
    escalation_slope: slope,
    contrast_index: contrastIndex,
    coherence_index: coherenceIndex,
    flatline_spans: flatSpan,
    tonal_flip_count: flips,
  };

  // Hard fail checks
  if (n < 4) failures.push("TOO_SHORT");
  if (peakEnergy < 0.85) failures.push("NO_PEAK");
  if (slope <= 0.01) failures.push("NO_ESCALATION");
  if (flatSpan >= 3) failures.push("FLATLINE");
  if (contrastIndex < 0.55) failures.push("LOW_CONTRAST");
  if (flips >= 2) failures.push("TONAL_WHIPLASH");

  // Score: start at 1.0, apply penalties
  let score = 1.0;
  if (failures.includes("TOO_SHORT")) score -= 0.3;
  if (failures.includes("NO_PEAK")) score -= 0.15;
  if (failures.includes("NO_ESCALATION")) score -= 0.15;
  if (failures.includes("FLATLINE")) score -= 0.10;
  if (failures.includes("LOW_CONTRAST")) score -= 0.10;
  if (failures.includes("TONAL_WHIPLASH")) score -= 0.10;

  // Small rewards
  score += contrastIndex * 0.05;
  score += coherenceIndex * 0.05;

  score = clamp(score, 0, 1);

  return {
    pass: failures.length === 0,
    score,
    failures,
    metrics,
  };
}
