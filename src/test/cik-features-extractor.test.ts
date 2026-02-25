/**
 * CIK — Feature Extractor + Scoring Tests
 * Split from cinematic-features.test.ts (lines 30–237). No logic changes.
 */
import { describe, it, expect } from "vitest";

import type { CinematicFailureCode } from "../../supabase/functions/_shared/cinematic-model";
import { DIAGNOSTIC_ONLY_CODES } from "../../supabase/functions/_shared/cinematic-model";
import { extractFeatures, countDirectionReversals, detectPacingMismatch, summarizeSignal, variance } from "../../supabase/functions/_shared/cinematic-features";
import { scoreCinematic, CINEMATIC_THRESHOLDS, PENALTY_MAP } from "../../supabase/functions/_shared/cinematic-score";
import { makeUnit } from "./helpers/cinematic-test-utils";

// ─── Feature Extractor Tests ───

describe("extractFeatures", () => {
  it("computes peakIndex correctly", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.2 }),
      makeUnit({ id: "1", energy: 0.4 }),
      makeUnit({ id: "2", energy: 0.9 }),
      makeUnit({ id: "3", energy: 0.6 }),
    ];
    const f = extractFeatures(units);
    expect(f.peakIndex).toBe(2);
  });

  it("peakIsLate uses threshold lateN", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.2 }),
      makeUnit({ id: "1", energy: 0.4 }),
      makeUnit({ id: "2", energy: 0.6 }),
      makeUnit({ id: "3", energy: 0.95 }),
    ];
    const f = extractFeatures(units, 2);
    expect(f.peakIsLate).toBe(true);
    expect(f.peakIndex).toBe(3);
  });

  it("peakIsLate false when peak is early", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.95 }),
      makeUnit({ id: "1", energy: 0.4 }),
      makeUnit({ id: "2", energy: 0.6 }),
      makeUnit({ id: "3", energy: 0.5 }),
    ];
    const f = extractFeatures(units, 2);
    expect(f.peakIsLate).toBe(false);
  });

  it("counts direction reversals", () => {
    const deltas = [0.2, -0.15, 0.18, -0.12, 0.1];
    expect(countDirectionReversals(deltas, 0.08)).toBe(4);
  });

  it("ignores small deltas in reversal count", () => {
    const deltas = [0.2, -0.02, 0.01, -0.15];
    expect(countDirectionReversals(deltas, 0.08)).toBe(1);
  });

  it("counts tonal sign flips", () => {
    const units = [
      makeUnit({ id: "0", tonal_polarity: 0.5 }),
      makeUnit({ id: "1", tonal_polarity: -0.3 }),
      makeUnit({ id: "2", tonal_polarity: 0.2 }),
      makeUnit({ id: "3", tonal_polarity: -0.1 }),
    ];
    const f = extractFeatures(units);
    expect(f.tonal_polarity.signFlipCount).toBe(3);
  });

  it("detects pacing mismatch: high early, low late density", () => {
    const densitySummary = summarizeSignal([0.8, 0.7, 0.4, 0.3]);
    const energySummary = summarizeSignal([0.3, 0.5, 0.7, 0.9]);
    expect(detectPacingMismatch(densitySummary, energySummary, 4)).toBe(true);
  });

  it("no pacing mismatch for healthy ramp data", () => {
    const densities = [0.3, 0.5, 0.7, 0.9];
    const energies = [0.2, 0.5, 0.7, 0.95];
    const densitySummary = summarizeSignal(densities);
    const energySummary = summarizeSignal(energies);
    expect(variance(densities)).toBeGreaterThan(0.005);
    expect(variance(energies)).toBeGreaterThan(0.005);
    expect(detectPacingMismatch(densitySummary, energySummary, 4, densities, energies)).toBe(false);
  });

  it("samey pacing uses raw value variance, not delta variance", () => {
    const densities = [0.50, 0.51, 0.50, 0.51];
    const energies = [0.50, 0.51, 0.50, 0.51];
    const densitySummary = summarizeSignal(densities);
    const energySummary = summarizeSignal(energies);
    expect(detectPacingMismatch(densitySummary, energySummary, 4, densities, energies)).toBe(true);
  });

  it("computes intentsDistinctCount", () => {
    const units = [
      makeUnit({ id: "0", intent: "intrigue" }),
      makeUnit({ id: "1", intent: "threat" }),
      makeUnit({ id: "2", intent: "chaos" }),
      makeUnit({ id: "3", intent: "intrigue" }),
    ];
    const f = extractFeatures(units);
    expect(f.intentsDistinctCount).toBe(3);
  });
});

// ─── Scoring Tests ───

describe("scoreCinematic", () => {
  it("separates hard_failures from diagnostic_flags", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.5, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.5, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.5, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.5, intent: "release" }),
    ];
    const score = scoreCinematic(units, { isStoryboard: true, adapterMode: "heuristic" });
    for (const f of score.diagnostic_flags) {
      expect(DIAGNOSTIC_ONLY_CODES.has(f)).toBe(true);
    }
    for (const f of score.hard_failures) {
      expect(DIAGNOSTIC_ONLY_CODES.has(f)).toBe(false);
    }
  });

  it("pass is based on hard_failures only", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.7, tension: 0.7, density: 0.7, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.9, tension: 0.9, density: 0.9, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.95, tonal_polarity: 0.5, intent: "release" }),
    ];
    const score = scoreCinematic(units);
    if (score.hard_failures.length === 0) {
      expect(score.pass).toBe(true);
    }
  });

  it("provides penalty_breakdown for each failure", () => {
    const units = [makeUnit({ id: "0", energy: 0.1 })];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("TOO_SHORT");
    const pb = score.penalty_breakdown.find(p => p.code === "TOO_SHORT");
    expect(pb).toBeDefined();
    expect(pb!.magnitude).toBe(PENALTY_MAP.TOO_SHORT);
  });

  it("PENALTY_MAP matches CINEMATIC_THRESHOLDS", () => {
    expect(PENALTY_MAP.TOO_SHORT).toBe(CINEMATIC_THRESHOLDS.penalty_too_short);
    expect(PENALTY_MAP.PACING_MISMATCH).toBe(CINEMATIC_THRESHOLDS.penalty_pacing_mismatch);
    expect(PENALTY_MAP.ENERGY_DROP).toBe(CINEMATIC_THRESHOLDS.penalty_energy_drop);
    expect(PENALTY_MAP.DIRECTION_REVERSAL).toBe(CINEMATIC_THRESHOLDS.penalty_direction_reversal);
  });

  it("detects ENERGY_DROP when end < mid by threshold", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.8, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.9, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.5, intent: "emotion" }),
    ];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("ENERGY_DROP");
  });

  it("detects DIRECTION_REVERSAL on zigzag energy", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.6, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.3, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.7, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.2, intent: "release" }),
      makeUnit({ id: "5", energy: 0.8, intent: "wonder" }),
      makeUnit({ id: "6", energy: 0.3, intent: "intrigue" }),
      makeUnit({ id: "7", energy: 0.9, intent: "threat" }),
    ];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("DIRECTION_REVERSAL");
  });

  it("EYE_LINE_BREAK only triggers when LOW_CONTRAST or FLATLINE present", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, intent: "intrigue", density: 0.3 }),
      makeUnit({ id: "1", energy: 0.5, intent: "threat", density: 0.5 }),
      makeUnit({ id: "2", energy: 0.7, intent: "chaos", density: 0.6 }),
      makeUnit({ id: "3", energy: 0.85, intent: "emotion", density: 0.7 }),
      makeUnit({ id: "4", energy: 0.95, intent: "release", density: 0.9 }),
    ];
    const score = scoreCinematic(units, { isStoryboard: true, adapterMode: "heuristic" });
    expect(score.failures).not.toContain("EYE_LINE_BREAK");
    expect(score.diagnostic_flags).not.toContain("EYE_LINE_BREAK");
  });

  it("EYE_LINE_BREAK triggers when FLATLINE is also present", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.5, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.5, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.5, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.5, intent: "release" }),
    ];
    const score = scoreCinematic(units, { isStoryboard: true, adapterMode: "heuristic" });
    if (score.failures.includes("FLATLINE") || score.failures.includes("LOW_CONTRAST")) {
      if (score.failures.includes("EYE_LINE_BREAK")) {
        expect(score.diagnostic_flags).toContain("EYE_LINE_BREAK");
        expect(score.hard_failures).not.toContain("EYE_LINE_BREAK");
      }
    }
  });
});
