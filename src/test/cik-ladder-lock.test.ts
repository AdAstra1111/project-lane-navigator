/**
 * CIK — Ladder Lock + Peak Clamp + Repair Prompt Tests
 * Split from cinematic-features.test.ts (lines 514–746). No logic changes.
 */
import { describe, it, expect } from "vitest";

import type { CinematicFailureCode, CinematicScore } from "../../supabase/functions/_shared/cinematic-model";
import { scoreCinematic } from "../../supabase/functions/_shared/cinematic-score";
import { buildTrailerRepairInstruction, numericTargetsForFailures } from "../../supabase/functions/_shared/cinematic-repair";
import { analyzeLadder } from "../../supabase/functions/_shared/cik/ladderLock";
import { makeUnit } from "./helpers/cinematic-test-utils";

// ─── CIK v3.12 Ladder Lock Tests ───

describe("analyzeLadder", () => {
  it("returns safe defaults for n<3", () => {
    const m = analyzeLadder([0.5, 0.6], [0.5, 0.6], [0.5, 0.6]);
    expect(m.n).toBe(2);
    expect(m.meaningfulDownSteps).toBe(0);
    expect(m.peakLate25).toBe(true);
  });

  it("detects multiple meaningful dips", () => {
    const energy =  [0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const tension = [0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const density = [0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const m = analyzeLadder(energy, tension, density);
    expect(m.meaningfulDownSteps).toBeGreaterThan(1);
  });

  it("detects late dip in final 25%", () => {
    const energy =  [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 0.5];
    const tension = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 0.5];
    const density = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 0.5];
    const m = analyzeLadder(energy, tension, density);
    expect(m.lateDownSteps).toBeGreaterThanOrEqual(1);
  });

  it("clean ramp has zero dips and late peak", () => {
    const energy =  [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    const tension = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    const density = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    const m = analyzeLadder(energy, tension, density);
    expect(m.meaningfulDownSteps).toBe(0);
    expect(m.lateDownSteps).toBe(0);
    expect(m.peakLate25).toBe(true);
    expect(m.upStepFrac).toBeGreaterThanOrEqual(0.55);
  });

  it("clamps out-of-range values", () => {
    const m = analyzeLadder([1.5, -0.3, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
    expect(m.n).toBe(3);
    expect(m.ladderMax).toBeLessThanOrEqual(1);
    expect(m.ladderMin).toBeGreaterThanOrEqual(0);
  });
});

describe("ladder lock scoring integration", () => {
  it("multiple meaningful dips => DIRECTION_REVERSAL", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.7, tension: 0.7, density: 0.7, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.2, tension: 0.2, density: 0.2, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.8, tension: 0.8, density: 0.8, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.1, tension: 0.1, density: 0.1, intent: "release" }),
      makeUnit({ id: "5", energy: 0.9, tension: 0.9, density: 0.9, intent: "wonder" }),
    ];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("DIRECTION_REVERSAL");
  });

  it("late dip in final 25% => ENERGY_DROP", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.2, tension: 0.2, density: 0.2, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.4, tension: 0.4, density: 0.4, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.5, tension: 0.5, density: 0.5, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.6, tension: 0.6, density: 0.6, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.7, tension: 0.7, density: 0.7, intent: "release" }),
      makeUnit({ id: "5", energy: 0.8, tension: 0.8, density: 0.8, intent: "wonder" }),
      makeUnit({ id: "6", energy: 0.95, tension: 0.95, density: 0.95, intent: "intrigue" }),
      makeUnit({ id: "7", energy: 0.5, tension: 0.5, density: 0.5, intent: "threat" }),
    ];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("ENERGY_DROP");
  });

  it("peak too early but present => WEAK_ARC not NO_PEAK", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.95, tension: 0.95, density: 0.95, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.4, tension: 0.4, density: 0.4, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.5, tension: 0.5, density: 0.5, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.6, tension: 0.6, density: 0.6, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.7, tension: 0.7, density: 0.7, intent: "release" }),
    ];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("clean ramp does NOT add ladder-triggered failures", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.7, tension: 0.7, density: 0.7, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.85, tension: 0.85, density: 0.85, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.95, tonal_polarity: 0.5, intent: "release" }),
    ];
    const score = scoreCinematic(units);
    if (score.hard_failures.length === 0) {
      expect(score.pass).toBe(true);
    }
  });
});

// ─── CIK v3.13 Peak Clamp + Tail Seal Tests ───

describe("v3.13 peak clamp + tail seal scoring", () => {
  it("late but non-dominant peak triggers LOW_CONTRAST or WEAK_ARC", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.65, tension: 0.65, density: 0.65, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.68, tension: 0.68, density: 0.68, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.66, tension: 0.66, density: 0.66, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.70, tension: 0.70, density: 0.70, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.72, tension: 0.72, density: 0.72, intent: "release" }),
    ];
    const score = scoreCinematic(units);
    const hasContrast = score.failures.includes("LOW_CONTRAST");
    const hasWeakArc = score.failures.includes("WEAK_ARC");
    expect(hasContrast || hasWeakArc).toBe(true);
  });

  it("tail not sealed triggers ENERGY_DROP", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.2, tension: 0.2, density: 0.2, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.4, tension: 0.4, density: 0.4, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.6, tension: 0.6, density: 0.6, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.95, tension: 0.95, density: 0.95, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.7, tension: 0.7, density: 0.7, intent: "release" }),
    ];
    const score = scoreCinematic(units);
    expect(score.failures).toContain("ENERGY_DROP");
  });

  it("sealed ending passes peak clamp + tail checks", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.7, tension: 0.7, density: 0.7, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.9, tension: 0.9, density: 0.9, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.92, tension: 0.92, density: 0.92, tonal_polarity: 0.5, intent: "release" }),
    ];
    const score = scoreCinematic(units);
    if (score.hard_failures.length === 0) {
      expect(score.pass).toBe(true);
    }
  });
});

describe("v3.13 repair targets", () => {
  const makeScore = (failures: CinematicFailureCode[]): CinematicScore => ({
    score: 0.3, pass: false, failures,
    hard_failures: failures, diagnostic_flags: [],
    penalty_breakdown: [], metrics: {} as any,
  });

  it("includes peak lead and tail seal targets for ladder failures", () => {
    const instr = buildTrailerRepairInstruction(makeScore(["LOW_CONTRAST", "ENERGY_DROP"]), 8);
    expect(instr).toContain("Peak lead");
    expect(instr).toContain("Tail seal");
  });

  it("stays under 2500 chars with v3.13 targets", () => {
    const instr = buildTrailerRepairInstruction(makeScore(["LOW_CONTRAST", "ENERGY_DROP", "WEAK_ARC"]), 8);
    expect(instr.length).toBeLessThanOrEqual(2500);
  });
});

describe("ladder lock repair prompt", () => {
  const makeScore = (failures: CinematicFailureCode[]): CinematicScore => ({
    score: 0.3, pass: false, failures,
    hard_failures: failures, diagnostic_flags: [],
    penalty_breakdown: [], metrics: {} as any,
  });

  it("includes LADDER LOCK within PROCEDURE block for ladder failures", () => {
    const instr = buildTrailerRepairInstruction(makeScore(["DIRECTION_REVERSAL"]), 8);
    expect(instr).toContain("LADDER LOCK (ATTEMPT 1)");
    expect(instr).toContain("final 25%");
    const procIdx = instr.indexOf("PROCEDURE (MANDATORY, ATTEMPT 1)");
    const ladderIdx = instr.indexOf("LADDER LOCK (ATTEMPT 1)");
    expect(procIdx).toBeGreaterThanOrEqual(0);
    expect(ladderIdx).toBeGreaterThan(procIdx);
  });

  it("includes compact ladder numeric targets for ENERGY_DROP", () => {
    const instr = buildTrailerRepairInstruction(makeScore(["ENERGY_DROP"]), 8);
    expect(instr).toContain("Rises ≥");
    expect(instr).toContain("Dips ≤1");
    expect(instr).toContain("Zigzags ≤");
  });

  it("ladder guidance survives even with many failures and stays under 2500 chars", () => {
    const manyFailures: CinematicFailureCode[] = [
      "NO_PEAK", "NO_ESCALATION", "FLATLINE", "LOW_CONTRAST",
      "TONAL_WHIPLASH", "WEAK_ARC", "LOW_INTENT_DIVERSITY",
      "PACING_MISMATCH", "ENERGY_DROP", "DIRECTION_REVERSAL",
    ];
    const instr = buildTrailerRepairInstruction(makeScore(manyFailures), 8);
    expect(instr).toContain("LADDER LOCK (ATTEMPT 1)");
    expect(instr).toContain("PROCEDURE (MANDATORY, ATTEMPT 1)");
    expect(instr).toContain("CONSTRAINTS (ATTEMPT 1)");
    expect(instr.length).toBeLessThanOrEqual(2500);
  });

  it("ladder failures covered, static targets omitted", () => {
    const { covered } = numericTargetsForFailures({ failures: ["DIRECTION_REVERSAL", "ENERGY_DROP"], unitCount: 8 });
    expect(covered.has("DIRECTION_REVERSAL")).toBe(true);
    expect(covered.has("ENERGY_DROP")).toBe(true);
  });

  it("no LADDER LOCK when no ladder failures", () => {
    const instr = buildTrailerRepairInstruction(makeScore(["TOO_SHORT"]), 4);
    expect(instr).not.toContain("LADDER LOCK");
  });

  it("failureBullets capped at 6 + 'Also address' for overflow", () => {
    const manyFailures: CinematicFailureCode[] = [
      "NO_PEAK", "NO_ESCALATION", "FLATLINE", "LOW_CONTRAST",
      "TONAL_WHIPLASH", "WEAK_ARC", "LOW_INTENT_DIVERSITY",
      "PACING_MISMATCH", "ENERGY_DROP", "DIRECTION_REVERSAL",
    ];
    const instr = buildTrailerRepairInstruction(makeScore(manyFailures), 8);
    expect(instr).toContain("Also address:");
  });
});
