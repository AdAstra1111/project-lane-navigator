/**
 * CIK v3.12 — Ladder Lock Constants
 * Deterministic threshold functions for near-monotonic energy ramp enforcement.
 */

export function dipAbsForUnitCount(n: number): number {
  if (n <= 8) return 0.08;
  if (n <= 12) return 0.06;
  return 0.05;
}

export function lateDipAbsForUnitCount(n: number): number {
  return dipAbsForUnitCount(n) * 0.8;
}

export function minUpFracForUnitCount(n: number): number {
  if (n <= 8) return 0.55;
  if (n <= 12) return 0.60;
  return 0.65;
}

export function maxZigzagFlipsForUnitCount(n: number): number {
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
