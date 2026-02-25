/**
 * Cinematic Intelligence Kernel — Deterministic scoring
 * Uses shared feature extractor. Pure math, no LLM calls.
 */
import type { CinematicUnit, CinematicScore, CinematicFailureCode, CinematicMetrics, PenaltyEntry } from "./cinematic-model.ts";
import { DIAGNOSTIC_ONLY_CODES } from "./cinematic-model.ts";
import { extractFeatures } from "./cinematic-features.ts";
import { analyzeLadder, type LadderMetrics } from "./cik/ladderLock.ts";
import { getCinematicThresholds } from "./cik/thresholdProfiles.ts";

// ─── Centralized thresholds (single source of truth) ───

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
  energy_drop_threshold: 0.15,
  max_direction_reversals: 3,
  // Penalties
  penalty_too_short: 0.30,
  penalty_no_peak: 0.15,
  penalty_no_escalation: 0.15,
  penalty_flatline: 0.10,
  penalty_low_contrast: 0.10,
  penalty_tonal_whiplash: 0.10,
  penalty_low_intent_diversity: 0.08,
  penalty_weak_arc: 0.10,
  penalty_pacing_mismatch: 0.06,
  penalty_energy_drop: 0.08,
  penalty_direction_reversal: 0.07,
  penalty_eye_line_break: 0.04,
} as const;

/** Map from failure code to penalty magnitude — derived from thresholds. */
export const PENALTY_MAP: Readonly<Record<CinematicFailureCode, number>> = {
  TOO_SHORT: CINEMATIC_THRESHOLDS.penalty_too_short,
  NO_PEAK: CINEMATIC_THRESHOLDS.penalty_no_peak,
  NO_ESCALATION: CINEMATIC_THRESHOLDS.penalty_no_escalation,
  FLATLINE: CINEMATIC_THRESHOLDS.penalty_flatline,
  LOW_CONTRAST: CINEMATIC_THRESHOLDS.penalty_low_contrast,
  TONAL_WHIPLASH: CINEMATIC_THRESHOLDS.penalty_tonal_whiplash,
  LOW_INTENT_DIVERSITY: CINEMATIC_THRESHOLDS.penalty_low_intent_diversity,
  WEAK_ARC: CINEMATIC_THRESHOLDS.penalty_weak_arc,
  PACING_MISMATCH: CINEMATIC_THRESHOLDS.penalty_pacing_mismatch,
  ENERGY_DROP: CINEMATIC_THRESHOLDS.penalty_energy_drop,
  DIRECTION_REVERSAL: CINEMATIC_THRESHOLDS.penalty_direction_reversal,
  EYE_LINE_BREAK: CINEMATIC_THRESHOLDS.penalty_eye_line_break,
};

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
  /** Product lane for threshold selection (e.g. "documentary", "vertical_drama") */
  lane?: string;
}

export function scoreCinematic(units: CinematicUnit[], ctx?: ScoringContext): CinematicScore {
  const T = getCinematicThresholds(ctx?.lane);
  const failures: CinematicFailureCode[] = [];
  const features = extractFeatures(units, T.min_arc_peak_in_last_n, ctx?.lane);

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

  // ─── Failure checks ───
  if (n < T.min_units) failures.push("TOO_SHORT");
  if (peakEnergy < T.min_peak_energy) failures.push("NO_PEAK");
  if (slope <= T.min_slope) failures.push("NO_ESCALATION");
  if (flatSpan >= T.flatline_span) failures.push("FLATLINE");
  if (contrastIndex < T.min_contrast) failures.push("LOW_CONTRAST");
  if (flips >= T.max_tonal_flips) failures.push("TONAL_WHIPLASH");

  if (n >= T.min_units) {
    if (features.intentsDistinctCount < T.min_intent_distinct) {
      failures.push("LOW_INTENT_DIVERSITY");
    } else {
      // CIK v3.14 — Intent Sequencing Lock
      const seq = features.intentSequencing;
      if (seq.earlyLateInversion && !failures.includes("WEAK_ARC")) {
        failures.push("WEAK_ARC");
      }
      if (seq.excessOscillation && !failures.includes("PACING_MISMATCH")) {
        failures.push("PACING_MISMATCH");
      }
    }
  }

  if (n >= T.min_units) {
    const early = units[0];
    const mid = units[Math.floor((n - 1) / 2)];
    const late = units[n - 1];
    const peakIdx = energies.indexOf(peakEnergy);
    if (
      late.energy < T.min_arc_end_energy ||
      mid.energy < T.min_arc_mid_energy ||
      peakIdx < n - T.min_arc_peak_in_last_n ||
      early.energy >= T.max_early_peak_energy
    ) {
      failures.push("WEAK_ARC");
    }
  }

  // ─── New checks ───
  if (n >= T.min_units) {
    if (features.pacingMismatch) failures.push("PACING_MISMATCH");

    if (features.energy.end < features.energy.mid - T.energy_drop_threshold) {
      failures.push("ENERGY_DROP");
    } else if (n >= 5) {
      const tail = Math.max(1, Math.floor(n * 0.2));
      const tailDeltas = features.energy.rollingDeltas.slice(-tail);
      const avgTailDelta = tailDeltas.reduce((s, v) => s + v, 0) / tailDeltas.length;
      if (avgTailDelta < -T.energy_drop_threshold / 2) failures.push("ENERGY_DROP");
    }

    if (features.directionReversalCount > T.max_direction_reversals) {
      failures.push("DIRECTION_REVERSAL");
    }

    // ─── CIK v3.12 Ladder Lock checks ───
    const ladder = analyzeLadder(energies, units.map(u => u.tension), units.map(u => u.density));
    if (ladder.n >= 3) {
      if (ladder.meaningfulDownSteps > 1 && !failures.includes("DIRECTION_REVERSAL")) {
        failures.push("DIRECTION_REVERSAL");
      }
      if (ladder.lateDownSteps >= 1 && !failures.includes("ENERGY_DROP")) {
        failures.push("ENERGY_DROP");
      }
      if (ladder.upStepFrac < ladder.minUpFrac && !failures.includes("FLATLINE")) {
        failures.push("FLATLINE");
      }
      if (ladder.zigzagFlips > ladder.maxFlips && !failures.includes("PACING_MISMATCH")) {
        failures.push("PACING_MISMATCH");
      }
      if (ladder.peakIndex > 0 && !ladder.peakLate25 && !failures.includes("NO_PEAK") && !failures.includes("WEAK_ARC")) {
        failures.push("WEAK_ARC");
      }
      if (ladder.peakDominance < ladder.peakDelta) {
        if (failures.includes("LOW_CONTRAST") && !failures.includes("WEAK_ARC")) {
          failures.push("WEAK_ARC");
        }
      }

      // ─── CIK v3.13 Peak Clamp + Tail Seal ───
      if (ladder.peakLead < ladder.peakLeadThreshold) {
        if (!failures.includes("LOW_CONTRAST")) {
          failures.push("LOW_CONTRAST");
        } else if (!failures.includes("WEAK_ARC")) {
          failures.push("WEAK_ARC");
        }
      }
      if (ladder.tailMean < ladder.peakValue - ladder.tailSlack && !failures.includes("ENERGY_DROP")) {
        failures.push("ENERGY_DROP");
      }
      // Penultimate peak with final drop (peak at n-2, final unit drops)
      if (ladder.peakIndex === n - 2 && n >= 4 && !failures.includes("ENERGY_DROP")) {
        // If peak is penultimate and tail mean is noticeably below peak, it's a drop
        const tailGap = ladder.peakValue - ladder.tailMean;
        if (tailGap > ladder.lateDipAbs / 2) {
          failures.push("ENERGY_DROP");
        }
      }
    }

    // EYE_LINE_BREAK: diagnostic-only, only added when LOW_CONTRAST or FLATLINE also present
    if (ctx?.isStoryboard && n >= 4) {
      const hasLowContrast = failures.includes("LOW_CONTRAST");
      const hasFlatline = failures.includes("FLATLINE");
      if (hasLowContrast || hasFlatline) {
        const intents = units.map(u => u.intent);
        let intentFlips = 0;
        for (let i = 1; i < intents.length; i++) {
          if (intents[i] !== intents[i - 1]) intentFlips++;
        }
        const intentFlipRate = intentFlips / (n - 1);
        if (intentFlipRate > 0.8 && ctx.adapterMode === "heuristic") {
          failures.push("EYE_LINE_BREAK");
        }
      }
    }
  }

  // ─── Separate hard vs diagnostic ───
  const hard_failures = failures.filter(f => !DIAGNOSTIC_ONLY_CODES.has(f));
  const diagnostic_flags = failures.filter(f => DIAGNOSTIC_ONLY_CODES.has(f));

  // ─── Score calculation with penalty breakdown (lane-aware penalties) ───
  const penaltyMap: Record<string, number> = {
    TOO_SHORT: T.penalty_too_short,
    NO_PEAK: T.penalty_no_peak,
    NO_ESCALATION: T.penalty_no_escalation,
    FLATLINE: T.penalty_flatline,
    LOW_CONTRAST: T.penalty_low_contrast,
    TONAL_WHIPLASH: T.penalty_tonal_whiplash,
    LOW_INTENT_DIVERSITY: T.penalty_low_intent_diversity,
    WEAK_ARC: T.penalty_weak_arc,
    PACING_MISMATCH: T.penalty_pacing_mismatch,
    ENERGY_DROP: T.penalty_energy_drop,
    DIRECTION_REVERSAL: T.penalty_direction_reversal,
    EYE_LINE_BREAK: T.penalty_eye_line_break,
  };
  const penalty_breakdown: PenaltyEntry[] = [];
  let score = 1.0;
  for (const code of failures) {
    const mag = penaltyMap[code] || 0;
    if (mag > 0) {
      score -= mag;
      penalty_breakdown.push({ code, magnitude: mag });
    }
  }

  score += contrastIndex * 0.05;
  score += coherenceIndex * 0.05;
  score = clamp(score, 0, 1);

  // Pass is determined by hard_failures only
  const pass = hard_failures.length === 0;

  return { pass, score, failures, hard_failures, diagnostic_flags, penalty_breakdown, metrics };
}
