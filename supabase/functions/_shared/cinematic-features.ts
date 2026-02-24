/**
 * Cinematic Intelligence Kernel — Deterministic Feature Extractor
 * Shared by trailer and storyboard engines. Pure math, no LLM.
 */
import type { CinematicUnit } from "./cinematic-model.ts";

export interface CinematicFeatures {
  unitCount: number;
  intentsDistinctCount: number;

  energy: SignalSummary;
  tension: SignalSummary;
  density: SignalSummary;

  tonal_polarity: PolaritySummary;

  peakIndex: number;
  peakIsLate: boolean;

  escalationScore: number;
  contrastScore: number;
  coherenceScore: number;

  directionReversalCount: number;
  pacingMismatch: boolean;
}

export interface SignalSummary {
  min: number;
  max: number;
  avg: number;
  start: number;
  mid: number;
  end: number;
  slope: number;
  rollingDeltas: number[];
}

export interface PolaritySummary {
  min: number;
  max: number;
  avg: number;
  signFlipCount: number;
  maxFlipMagnitude: number;
  oscillationScore: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function summarizeSignal(values: number[]): SignalSummary {
  const n = values.length;
  if (n === 0) return { min: 0, max: 0, avg: 0, start: 0, mid: 0, end: 0, slope: 0, rollingDeltas: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / n;
  const start = values[0];
  const mid = values[Math.floor((n - 1) / 2)];
  const end = values[n - 1];
  const slope = end - start;
  const rollingDeltas: number[] = [];
  for (let i = 1; i < n; i++) {
    rollingDeltas.push(values[i] - values[i - 1]);
  }
  return { min, max, avg, start, mid, end, slope, rollingDeltas };
}

function summarizePolarity(units: CinematicUnit[]): PolaritySummary {
  const values = units.map(u => u.tonal_polarity);
  const n = values.length;
  if (n === 0) return { min: 0, max: 0, avg: 0, signFlipCount: 0, maxFlipMagnitude: 0, oscillationScore: 0 };

  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((s, v) => s + v, 0) / n;

  let signFlipCount = 0;
  let maxFlipMagnitude = 0;
  let oscillationScore = 0;

  for (let i = 1; i < n; i++) {
    const prev = values[i - 1];
    const curr = values[i];
    const mag = Math.abs(curr - prev);
    if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) {
      signFlipCount++;
      maxFlipMagnitude = Math.max(maxFlipMagnitude, mag);
    }
    // Oscillation: penalize sign changes weighted by magnitude
    if (i >= 2) {
      const pp = values[i - 2];
      // zigzag: sign changed twice in 3 units
      if ((pp > 0 && prev < 0 && curr > 0) || (pp < 0 && prev > 0 && curr < 0)) {
        oscillationScore += mag;
      }
    }
  }

  return { min, max, avg, signFlipCount, maxFlipMagnitude, oscillationScore: clamp(oscillationScore, 0, 3) };
}

function countDirectionReversals(deltas: number[], threshold: number): number {
  let reversals = 0;
  let lastSign = 0;
  for (const d of deltas) {
    if (Math.abs(d) < threshold) continue;
    const sign = d > 0 ? 1 : -1;
    if (lastSign !== 0 && sign !== lastSign) reversals++;
    lastSign = sign;
  }
  return reversals;
}

function detectPacingMismatch(
  density: SignalSummary,
  energy: SignalSummary,
  unitCount: number,
): boolean {
  if (unitCount < 4) return false;
  // High density early + low density late
  const earlyDensityHigh = density.start > 0.7 && density.end < 0.5;
  // Low density late when energy is high
  const lateDensityLow = density.end < 0.35 && energy.end > 0.7;
  // Near-zero variance in both → "samey pacing"
  const densityVar = variance(density.rollingDeltas);
  const energyVar = variance(energy.rollingDeltas);
  const samey = densityVar < 0.005 && energyVar < 0.005 && unitCount >= 4;

  return earlyDensityHigh || lateDensityLow || samey;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

export function extractFeatures(units: CinematicUnit[]): CinematicFeatures {
  const n = units.length;
  const energies = units.map(u => u.energy);
  const tensions = units.map(u => u.tension);
  const densities = units.map(u => u.density);

  const energy = summarizeSignal(energies);
  const tension = summarizeSignal(tensions);
  const density = summarizeSignal(densities);
  const tonal_polarity = summarizePolarity(units);

  const peakIndex = n > 0 ? energies.indexOf(Math.max(...energies)) : 0;
  const lateWindowStart = Math.max(0, n - 2);
  const peakIsLate = peakIndex >= lateWindowStart;

  // Escalation: reward monotonic-ish trend, penalize plateaus
  let escalationScore = 0;
  if (n >= 2) {
    let rises = 0;
    let plateaus = 0;
    for (const d of energy.rollingDeltas) {
      if (d > 0.02) rises++;
      else if (Math.abs(d) <= 0.03) plateaus++;
    }
    escalationScore = clamp((rises / (n - 1)) - (plateaus / (n - 1)) * 0.3, 0, 1);
  }

  // Contrast: reward early-low → late-high
  let contrastScore = 0;
  if (n >= 4) {
    const earlyAvg = energies.slice(0, Math.ceil(n / 3)).reduce((s, v) => s + v, 0) / Math.ceil(n / 3);
    const lateAvg = energies.slice(-Math.ceil(n / 3)).reduce((s, v) => s + v, 0) / Math.ceil(n / 3);
    contrastScore = clamp((lateAvg - earlyAvg) * 2, 0, 1);
  }

  // Coherence: penalize polarity oscillation + whiplash energy reversals
  const directionReversalCount = countDirectionReversals(energy.rollingDeltas, 0.08);
  let coherenceScore = 1.0;
  coherenceScore -= clamp(tonal_polarity.oscillationScore * 0.2, 0, 0.4);
  coherenceScore -= clamp(directionReversalCount * 0.1, 0, 0.4);
  coherenceScore = clamp(coherenceScore, 0, 1);

  const pacingMismatch = detectPacingMismatch(density, energy, n);

  return {
    unitCount: n,
    intentsDistinctCount: new Set(units.map(u => u.intent)).size,
    energy,
    tension,
    density,
    tonal_polarity,
    peakIndex,
    peakIsLate,
    escalationScore,
    contrastScore,
    coherenceScore,
    directionReversalCount,
    pacingMismatch,
  };
}
