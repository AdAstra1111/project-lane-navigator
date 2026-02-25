/**
 * CIK v3.12/v3.13 — Ladder Lock Constants
 * Deterministic threshold functions for near-monotonic energy ramp enforcement.
 * v4.1: Lane-aware multipliers for vertical_drama and documentary.
 */

// Lane multiplier helpers (deterministic constants)
function laneDipMul(lane?: string): number {
  if (lane === "documentary") return 1.15;
  return 1.0;
}
function laneLateDipMul(lane?: string): number {
  if (lane === "vertical_drama") return 0.75;
  if (lane === "documentary") return 1.15;
  return 1.0;
}
function laneTailSlackMul(lane?: string): number {
  if (lane === "vertical_drama") return 0.75;
  if (lane === "documentary") return 1.35;
  return 1.0;
}

export function dipAbsForUnitCount(n: number, lane?: string): number {
  let base: number;
  if (n <= 8) base = 0.08;
  else if (n <= 12) base = 0.06;
  else base = 0.05;
  return base * laneDipMul(lane);
}

export function lateDipAbsForUnitCount(n: number, lane?: string): number {
  return dipAbsForUnitCount(n, lane) * 0.8 * (laneLateDipMul(lane) / laneDipMul(lane || ""));
}

export function minUpFracForUnitCount(n: number, _lane?: string): number {
  if (n <= 8) return 0.55;
  if (n <= 12) return 0.60;
  return 0.65;
}

export function maxZigzagFlipsForUnitCount(n: number, _lane?: string): number {
  if (n <= 8) return 2;
  if (n <= 12) return 3;
  return 4;
}

export function peakDeltaForUnitCount(n: number): number {
  if (n <= 8) return 0.18;
  if (n <= 12) return 0.15;
  return 0.12;
}

export function lateStartIndexForUnitCount(n: number): number {
  return Math.floor(0.75 * n);
}

// v3.13 — Peak Clamp + Tail Seal thresholds
export function peakLeadThresholdForUnitCount(n: number, _lane?: string): number {
  if (n <= 8) return 0.10;
  if (n <= 12) return 0.08;
  return 0.06;
}

export function tailSlackForUnitCount(n: number, lane?: string): number {
  let base: number;
  if (n <= 8) base = 0.06;
  else if (n <= 12) base = 0.05;
  else base = 0.04;
  return base * laneTailSlackMul(lane);
}
