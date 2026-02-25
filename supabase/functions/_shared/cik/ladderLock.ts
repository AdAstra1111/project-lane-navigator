/**
 * CIK v3.12/v3.13 — Ladder Lock Analyzer
 * Deterministic near-monotonic ramp analysis on weighted signal.
 * Pure math, no LLM. O(n) only.
 */
import {
  dipAbsForUnitCount,
  lateDipAbsForUnitCount,
  minUpFracForUnitCount,
  maxZigzagFlipsForUnitCount,
  peakDeltaForUnitCount,
  lateStartIndexForUnitCount,
  peakLeadThresholdForUnitCount,
  tailSlackForUnitCount,
} from "./ladderLockConstants.ts";

// Fixed signal weights
const W_ENERGY = 0.45;
const W_TENSION = 0.35;
const W_DENSITY = 0.20;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function deterministicMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface LadderMetrics {
  n: number;
  lateStart: number;
  dipAbs: number;
  lateDipAbs: number;
  minUpFrac: number;
  maxFlips: number;
  peakDelta: number;
  meaningfulDownSteps: number;
  lateDownSteps: number;
  upSteps: number;
  upStepFrac: number;
  zigzagFlips: number;
  peakIndex: number;
  peakValue: number;
  peakLate25: boolean;
  peakDominance: number;
  ladderMin: number;
  ladderMedian: number;
  ladderMax: number;
  // v3.13 Peak Clamp + Tail Seal
  peakLead: number;
  peakLeadThreshold: number;
  tailMean: number;
  tailSlack: number;
}

const SAFE_DEFAULTS: LadderMetrics = {
  n: 0, lateStart: 0, dipAbs: 0.08, lateDipAbs: 0.064,
  minUpFrac: 0.55, maxFlips: 2, peakDelta: 0.18,
  meaningfulDownSteps: 0, lateDownSteps: 0,
  upSteps: 0, upStepFrac: 1,
  zigzagFlips: 0, peakIndex: 0, peakValue: 0,
  peakLate25: true, peakDominance: 0,
  ladderMin: 0, ladderMedian: 0, ladderMax: 0,
  peakLead: 1, peakLeadThreshold: 0.10,
  tailMean: 1, tailSlack: 0.06,
};

export function analyzeLadder(
  energy: number[],
  tension: number[],
  density: number[],
  lane?: string,
): LadderMetrics {
  const minLen = Math.min(energy.length, tension.length, density.length);
  if (minLen < 3) return { ...SAFE_DEFAULTS, n: minLen };

  const n = minLen;

  // Build weighted ladder signal
  const ladder: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    ladder[i] = clamp01(energy[i]) * W_ENERGY + clamp01(tension[i]) * W_TENSION + clamp01(density[i]) * W_DENSITY;
  }

  // Deltas
  const deltas: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    deltas[i] = ladder[i + 1] - ladder[i];
  }

  const lateStart = lateStartIndexForUnitCount(n, lane);
  const dipAbs = dipAbsForUnitCount(n, lane);
  const lateDipAbs = lateDipAbsForUnitCount(n, lane);
  const minUpFrac = minUpFracForUnitCount(n, lane);
  const maxFlips = maxZigzagFlipsForUnitCount(n, lane);
  const peakDelta = peakDeltaForUnitCount(n);

  let meaningfulDownSteps = 0;
  let lateDownSteps = 0;
  let upSteps = 0;
  let zigzagFlips = 0;

  for (let i = 0; i < deltas.length; i++) {
    const d = deltas[i];
    if (d <= -dipAbs) meaningfulDownSteps++;
    if ((i + 1) >= lateStart && d <= -lateDipAbs) lateDownSteps++;
    if (d >= 0.01) upSteps++;
  }

  const upStepFrac = deltas.length > 0 ? upSteps / deltas.length : 1;

  // Zigzag flips
  let lastSignificantSign = 0;
  for (let i = 0; i < deltas.length; i++) {
    if (Math.abs(deltas[i]) < 0.02) continue;
    const sign = deltas[i] > 0 ? 1 : -1;
    if (lastSignificantSign !== 0 && sign !== lastSignificantSign) zigzagFlips++;
    lastSignificantSign = sign;
  }

  // Peak
  let peakIndex = 0;
  let peakValue = ladder[0];
  for (let i = 1; i < n; i++) {
    if (ladder[i] > peakValue) { peakValue = ladder[i]; peakIndex = i; }
  }
  const peakLate25 = peakIndex >= lateStart;

  const med = deterministicMedian(ladder);
  const peakDominance = peakValue - med;

  let ladderMin = ladder[0], ladderMax = ladder[0];
  for (let i = 1; i < n; i++) {
    if (ladder[i] < ladderMin) ladderMin = ladder[i];
    if (ladder[i] > ladderMax) ladderMax = ladder[i];
  }

  // v3.13 — Peak Lead: peakValue vs max of pre-late window
  const pLeadThreshold = peakLeadThresholdForUnitCount(n, lane);
  let preLateMax = 0;
  for (let i = 0; i < Math.min(lateStart, n); i++) {
    if (ladder[i] > preLateMax) preLateMax = ladder[i];
  }
  const peakLead = peakValue - preLateMax;

  // v3.13 — Tail Seal: mean of last 2 units
  const tSlack = tailSlackForUnitCount(n, lane);
  const tailCount = Math.min(2, n);
  let tailSum = 0;
  for (let i = n - tailCount; i < n; i++) {
    tailSum += ladder[i];
  }
  const tailMean = tailSum / tailCount;

  return {
    n, lateStart, dipAbs, lateDipAbs, minUpFrac, maxFlips, peakDelta,
    meaningfulDownSteps, lateDownSteps, upSteps, upStepFrac, zigzagFlips,
    peakIndex, peakValue, peakLate25, peakDominance,
    ladderMin, ladderMedian: med, ladderMax,
    peakLead, peakLeadThreshold: pLeadThreshold, tailMean, tailSlack: tSlack,
  };
}
