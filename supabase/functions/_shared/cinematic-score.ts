/**
 * Cinematic Intelligence Kernel — Deterministic scoring
 * Pure math, no LLM calls.
 */
import type { CinematicUnit, CinematicScore, CinematicFailureCode, CinematicMetrics } from "./cinematic-model.ts";

// ─── Centralized thresholds ───

export const CINEMATIC_THRESHOLDS = {
  min_units: 4,
  min_peak_energy: 0.85,
  min_slope: 0.01,
  flatline_eps: 0.03,
  flatline_span: 3,
  min_contrast: 0.55,
  max_tonal_flips: 2,
  min_intent_distinct: 3,
  min_arc_end_energy: 0.80,
  min_arc_mid_energy: 0.55,
  min_arc_peak_in_last_n: 2,
  max_early_peak_energy: 0.80,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function longestFlatlineSpan(units: CinematicUnit[], eps: number): number {
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

function tonalFlipCount(units: CinematicUnit[]): number {
  let flips = 0;
  for (let i = 1; i < units.length; i++) {
    const prev = units[i - 1].tonal_polarity;
    const curr = units[i].tonal_polarity;
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) flips++;
  }
  return flips;
}

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

export function scoreCinematic(units: CinematicUnit[]): CinematicScore {
  const T = CINEMATIC_THRESHOLDS;
  const failures: CinematicFailureCode[] = [];

  const n = units.length;
  const energies = units.map(u => u.energy);
  const peakEnergy = energies.length > 0 ? Math.max(...energies) : 0;
  const slope = escalationSlope(units);
  const flatSpan = longestFlatlineSpan(units, T.flatline_eps);
  const flips = tonalFlipCount(units);

  const contrastIndex = clamp(Math.sqrt(variance(energies)) * 3, 0, 1);

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

  if (n < T.min_units) failures.push("TOO_SHORT");
  if (peakEnergy < T.min_peak_energy) failures.push("NO_PEAK");
  if (slope <= T.min_slope) failures.push("NO_ESCALATION");
  if (flatSpan >= T.flatline_span) failures.push("FLATLINE");
  if (contrastIndex < T.min_contrast) failures.push("LOW_CONTRAST");
  if (flips >= T.max_tonal_flips) failures.push("TONAL_WHIPLASH");

  // Intent diversity check
  if (n >= T.min_units) {
    const distinctIntents = new Set(units.map(u => u.intent)).size;
    if (distinctIntents < T.min_intent_distinct) failures.push("LOW_INTENT_DIVERSITY");
  }

  // Arc strength check
  if (n >= T.min_units) {
    const early = units[0];
    const mid = units[Math.floor((n - 1) / 2)];
    const late = units[n - 1];
    const peakIndex = energies.indexOf(peakEnergy);
    if (
      late.energy < T.min_arc_end_energy ||
      mid.energy < T.min_arc_mid_energy ||
      peakIndex < n - T.min_arc_peak_in_last_n ||
      early.energy >= T.max_early_peak_energy
    ) {
      failures.push("WEAK_ARC");
    }
  }

  let score = 1.0;
  if (failures.includes("TOO_SHORT")) score -= 0.3;
  if (failures.includes("NO_PEAK")) score -= 0.15;
  if (failures.includes("NO_ESCALATION")) score -= 0.15;
  if (failures.includes("FLATLINE")) score -= 0.10;
  if (failures.includes("LOW_CONTRAST")) score -= 0.10;
  if (failures.includes("TONAL_WHIPLASH")) score -= 0.10;
  if (failures.includes("LOW_INTENT_DIVERSITY")) score -= 0.08;
  if (failures.includes("WEAK_ARC")) score -= 0.10;

  score += contrastIndex * 0.05;
  score += coherenceIndex * 0.05;
  score = clamp(score, 0, 1);

  return { pass: failures.length === 0, score, failures, metrics };
