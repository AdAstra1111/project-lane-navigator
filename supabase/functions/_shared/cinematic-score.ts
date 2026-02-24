/**
 * Cinematic Intelligence Kernel — Deterministic scoring
 * Uses shared feature extractor. Pure math, no LLM calls.
 */
import type { CinematicUnit, CinematicScore, CinematicFailureCode, CinematicMetrics } from "./cinematic-model.ts";
import { extractFeatures, type CinematicFeatures } from "./cinematic-features.ts";

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
  // New thresholds
  energy_drop_threshold: 0.15,
  max_direction_reversals: 3,
  pacing_penalty: 0.06,
  energy_drop_penalty: 0.08,
  direction_reversal_penalty: 0.07,
  eye_line_break_penalty: 0.04,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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

export interface ScoringContext {
  isStoryboard?: boolean;
  adapterMode?: string;
}

export function scoreCinematic(units: CinematicUnit[], ctx?: ScoringContext): CinematicScore {
  const T = CINEMATIC_THRESHOLDS;
  const failures: CinematicFailureCode[] = [];
  const features = extractFeatures(units);

  const n = units.length;
  const energies = units.map(u => u.energy);
  const peakEnergy = energies.length > 0 ? Math.max(...energies) : 0;
  const slope = escalationSlope(units);
  const flatSpan = longestFlatlineSpan(units, T.flatline_eps);
  const flips = features.tonal_polarity.signFlipCount;

  const contrastIndex = clamp(features.contrastScore, 0, 1);

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

  // ─── Original failure checks ───
  if (n < T.min_units) failures.push("TOO_SHORT");
  if (peakEnergy < T.min_peak_energy) failures.push("NO_PEAK");
  if (slope <= T.min_slope) failures.push("NO_ESCALATION");
  if (flatSpan >= T.flatline_span) failures.push("FLATLINE");
  if (contrastIndex < T.min_contrast) failures.push("LOW_CONTRAST");
  if (flips >= T.max_tonal_flips) failures.push("TONAL_WHIPLASH");

  if (n >= T.min_units) {
    const distinctIntents = new Set(units.map(u => u.intent)).size;
    if (distinctIntents < T.min_intent_distinct) failures.push("LOW_INTENT_DIVERSITY");
  }

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

  // ─── New diagnostic checks ───
  if (n >= T.min_units) {
    // PACING_MISMATCH
    if (features.pacingMismatch) failures.push("PACING_MISMATCH");

    // ENERGY_DROP: end energy below mid by threshold OR last 20% trending negative
    if (features.energy.end < features.energy.mid - T.energy_drop_threshold) {
      failures.push("ENERGY_DROP");
    } else if (n >= 5) {
      const tail = Math.max(1, Math.floor(n * 0.2));
      const tailDeltas = features.energy.rollingDeltas.slice(-tail);
      const avgTailDelta = tailDeltas.reduce((s, v) => s + v, 0) / tailDeltas.length;
      if (avgTailDelta < -T.energy_drop_threshold / 2) failures.push("ENERGY_DROP");
    }

    // DIRECTION_REVERSAL
    if (features.directionReversalCount > T.max_direction_reversals) {
      failures.push("DIRECTION_REVERSAL");
    }

    // EYE_LINE_BREAK (storyboard only, diagnostic)
    if (ctx?.isStoryboard && n >= 4) {
      const intents = units.map(u => u.intent);
      let intentFlips = 0;
      for (let i = 1; i < intents.length; i++) {
        if (intents[i] !== intents[i - 1]) intentFlips++;
      }
      const intentFlipRate = intentFlips / (n - 1);
      // High flip rate with heuristic adapter → likely unreliable
      if (intentFlipRate > 0.8 && ctx.adapterMode === "heuristic") {
        // Only flag if combined with other issues
        if (failures.includes("LOW_CONTRAST") || failures.includes("FLATLINE")) {
          failures.push("EYE_LINE_BREAK");
        }
      }
    }
  }

  // ─── Score calculation ───
  let score = 1.0;
  if (failures.includes("TOO_SHORT")) score -= 0.3;
  if (failures.includes("NO_PEAK")) score -= 0.15;
  if (failures.includes("NO_ESCALATION")) score -= 0.15;
  if (failures.includes("FLATLINE")) score -= 0.10;
  if (failures.includes("LOW_CONTRAST")) score -= 0.10;
  if (failures.includes("TONAL_WHIPLASH")) score -= 0.10;
  if (failures.includes("LOW_INTENT_DIVERSITY")) score -= 0.08;
  if (failures.includes("WEAK_ARC")) score -= 0.10;
  if (failures.includes("PACING_MISMATCH")) score -= T.pacing_penalty;
  if (failures.includes("ENERGY_DROP")) score -= T.energy_drop_penalty;
  if (failures.includes("DIRECTION_REVERSAL")) score -= T.direction_reversal_penalty;
  if (failures.includes("EYE_LINE_BREAK")) score -= T.eye_line_break_penalty;

  score += contrastIndex * 0.05;
  score += coherenceIndex * 0.05;
  score = clamp(score, 0, 1);

  return { pass: failures.length === 0, score, failures, metrics };
}
