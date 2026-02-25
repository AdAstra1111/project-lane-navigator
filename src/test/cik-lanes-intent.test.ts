/**
 * CIK — Intent Sequencing + Lane Profiles + Lane-Aware Ladder/Window Tests
 * Split from cinematic-features.test.ts (lines 748–972). No logic changes.
 */
import { describe, it, expect } from "vitest";

import type { CinematicFailureCode, CinematicScore } from "../../supabase/functions/_shared/cinematic-model";
import { scoreCinematic, CINEMATIC_THRESHOLDS } from "../../supabase/functions/_shared/cinematic-score";
import { buildTrailerRepairInstruction } from "../../supabase/functions/_shared/cinematic-repair";
import { analyzeIntentSequencing } from "../../supabase/functions/_shared/cinematic-features";
import { analyzeLadder } from "../../supabase/functions/_shared/cik/ladderLock";
import { lateStartIndexForUnitCount, tailSlackForUnitCount, lateDipAbsForUnitCount } from "../../supabase/functions/_shared/cik/ladderLockConstants";
import { getCinematicThresholds } from "../../supabase/functions/_shared/cik/thresholdProfiles";
import { makeUnit } from "./helpers/cinematic-test-utils";

// ─── CIK v3.14 Intent Sequencing Lock Tests ───

describe("v3.14 intent sequencing", () => {
  it("late window dominated by early intents triggers WEAK_ARC", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.6, tension: 0.6, density: 0.6, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.85, tension: 0.85, density: 0.85, intent: "intrigue" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.95, intent: "wonder" }),
    ];
    const seq = analyzeIntentSequencing(units);
    expect(seq.earlyLateInversion).toBe(true);
    const score = scoreCinematic(units);
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("early window dominated by late intents triggers WEAK_ARC", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, intent: "release" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, intent: "emotion" }),
      makeUnit({ id: "2", energy: 0.6, tension: 0.6, density: 0.6, intent: "threat" }),
      makeUnit({ id: "3", energy: 0.85, tension: 0.85, density: 0.85, intent: "chaos" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.95, intent: "release" }),
    ];
    const seq = analyzeIntentSequencing(units);
    expect(seq.earlyLateInversion).toBe(true);
  });

  it("clean phase sequence passes intent sequencing checks", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.7, tension: 0.7, density: 0.7, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.9, tension: 0.9, density: 0.9, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.92, tension: 0.92, density: 0.92, tonal_polarity: 0.5, intent: "release" }),
    ];
    const seq = analyzeIntentSequencing(units);
    expect(seq.earlyLateInversion).toBe(false);
    expect(seq.excessOscillation).toBe(false);
  });

  it("repair includes compact intent sequencing target when WEAK_ARC and diversity ok", () => {
    const score: CinematicScore = {
      score: 0.3, pass: false,
      failures: ["WEAK_ARC"] as CinematicFailureCode[],
      hard_failures: ["WEAK_ARC"] as CinematicFailureCode[],
      diagnostic_flags: [], penalty_breakdown: [], metrics: {} as any,
    };
    const instr = buildTrailerRepairInstruction(score, 6);
    expect(instr).toContain("INTENT SEQUENCING");
    expect(instr).toContain("early=setup/intrigue");
    expect(instr.length).toBeLessThanOrEqual(2500);
  });

  it("50% early intents in late window: triggers for feature_film, not for documentary", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, intent: "threat" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, intent: "chaos" }),
      makeUnit({ id: "2", energy: 0.85, tension: 0.85, density: 0.85, intent: "intrigue" }),
      makeUnit({ id: "3", energy: 0.95, tension: 0.95, density: 0.95, intent: "emotion" }),
    ];
    const seqFeature = analyzeIntentSequencing(units, "feature_film");
    const seqDoc = analyzeIntentSequencing(units, "documentary");
    expect(seqFeature.earlyLateInversion).toBe(true);
    expect(seqDoc.earlyLateInversion).toBe(false);
  });
});

// ─── Product-Lane Threshold Profiles Tests ───

describe("threshold profiles", () => {
  it("unknown lane returns exact defaults", () => {
    const t = getCinematicThresholds("unknown_thing");
    expect(t.min_units).toBe(CINEMATIC_THRESHOLDS.min_units);
    expect(t.min_contrast).toBe(CINEMATIC_THRESHOLDS.min_contrast);
    expect(t.max_tonal_flips).toBe(CINEMATIC_THRESHOLDS.max_tonal_flips);
    expect(t.penalty_low_contrast).toBe(CINEMATIC_THRESHOLDS.penalty_low_contrast);
  });

  it("undefined lane returns exact defaults", () => {
    const t = getCinematicThresholds(undefined);
    expect(t.min_units).toBe(CINEMATIC_THRESHOLDS.min_units);
  });

  it("vertical_drama profile differs in expected fields", () => {
    const t = getCinematicThresholds("vertical_drama");
    expect(t.min_units).toBe(3);
    expect(t.min_slope).toBe(0.03);
    expect(t.min_peak_energy).toBe(0.90);
    expect(t.energy_drop_threshold).toBe(0.10);
    expect(t.min_contrast).toBe(CINEMATIC_THRESHOLDS.min_contrast);
  });

  it("documentary profile differs in expected fields", () => {
    const t = getCinematicThresholds("documentary");
    expect(t.min_contrast).toBe(0.40);
    expect(t.max_tonal_flips).toBe(3);
    expect(t.penalty_low_contrast).toBe(0.06);
    expect(t.penalty_tonal_whiplash).toBe(0.06);
    expect(t.min_arc_end_energy).toBe(0.65);
    expect(t.max_direction_reversals).toBe(4);
    expect(t.min_units).toBe(CINEMATIC_THRESHOLDS.min_units);
  });

  it("series profile has tighter peak-late", () => {
    const t = getCinematicThresholds("series");
    expect(t.min_arc_peak_in_last_n).toBe(3);
    expect(t.min_arc_mid_energy).toBe(0.50);
  });

  it("units failing contrast under feature_film pass under documentary", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.40, tension: 0.40, density: 0.40, tonal_polarity: -0.2, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.50, tension: 0.50, density: 0.50, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.65, tension: 0.65, density: 0.65, tonal_polarity: 0.0, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.85, tension: 0.85, density: 0.85, tonal_polarity: 0.2, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.95, tonal_polarity: 0.4, intent: "release" }),
    ];
    const featureScore = scoreCinematic(units, { lane: "feature_film" });
    const docScore = scoreCinematic(units, { lane: "documentary" });
    const featureHasContrast = featureScore.failures.includes("LOW_CONTRAST");
    const docHasContrast = docScore.failures.includes("LOW_CONTRAST");
    if (featureHasContrast) {
      expect(docHasContrast).toBe(false);
    }
  });
});

// ─── Lane-Aware Ladder Thresholds Tests ───

describe("lane-aware ladder thresholds", () => {
  it("documentary tailSlack > feature_film tailSlack for same n", () => {
    const docSlack = tailSlackForUnitCount(6, "documentary");
    const featureSlack = tailSlackForUnitCount(6);
    expect(docSlack).toBeGreaterThan(featureSlack);
  });

  it("vertical_drama lateDipAbs < feature_film lateDipAbs for same n", () => {
    const vdDip = lateDipAbsForUnitCount(6, "vertical_drama");
    const featureDip = lateDipAbsForUnitCount(6);
    expect(vdDip).toBeLessThan(featureDip);
  });

  it("unknown lane preserves exact default ladder metrics", () => {
    const energy =  [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    const tension = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    const density = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
    const defaultM = analyzeLadder(energy, tension, density);
    const unknownM = analyzeLadder(energy, tension, density, "unknown_lane");
    expect(unknownM.dipAbs).toBe(defaultM.dipAbs);
    expect(unknownM.lateDipAbs).toBe(defaultM.lateDipAbs);
    expect(unknownM.tailSlack).toBe(defaultM.tailSlack);
  });

  it("ending fails tail seal under vertical_drama but passes under documentary", () => {
    const units = [
      makeUnit({ id: "0", energy: 0.30, tension: 0.30, density: 0.30, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.50, tension: 0.50, density: 0.50, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.70, tension: 0.70, density: 0.70, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.92, tension: 0.92, density: 0.92, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.87, tension: 0.87, density: 0.87, tonal_polarity: 0.5, intent: "release" }),
    ];
    const vdScore = scoreCinematic(units, { lane: "vertical_drama" });
    const docScore = scoreCinematic(units, { lane: "documentary" });
    const vdHasDrop = vdScore.failures.includes("ENERGY_DROP");
    const docHasDrop = docScore.failures.includes("ENERGY_DROP");
    if (vdHasDrop) {
      expect(docHasDrop).toBe(false);
    }
  });
});

// ─── Lane-Aware Late Window Tests ───

describe("lane-aware late window", () => {
  it("lateStart differs per lane for n=10", () => {
    expect(lateStartIndexForUnitCount(10)).toBe(7);
    expect(lateStartIndexForUnitCount(10, "feature_film")).toBe(7);
    expect(lateStartIndexForUnitCount(10, "series")).toBe(7);
    expect(lateStartIndexForUnitCount(10, "vertical_drama")).toBe(6);
    expect(lateStartIndexForUnitCount(10, "documentary")).toBe(6);
  });

  it("unknown lane preserves default lateStart", () => {
    expect(lateStartIndexForUnitCount(10, "unknown")).toBe(7);
    expect(lateStartIndexForUnitCount(10, undefined)).toBe(7);
  });

  it("peak at index 6 of 10: fails feature_film peak-late, passes vertical_drama", () => {
    const units = Array.from({ length: 10 }, (_, i) => {
      const e = i === 6 ? 0.95 : 0.3 + i * 0.05;
      return makeUnit({
        id: String(i),
        energy: Math.min(e, 0.95),
        tension: Math.min(e, 0.95),
        density: Math.min(e, 0.95),
        tonal_polarity: -0.3 + i * 0.07,
        intent: (["intrigue", "threat", "chaos", "emotion", "release", "wonder", "intrigue", "threat", "chaos", "emotion"] as const)[i],
      });
    });
    const featureLadder = analyzeLadder(
      units.map(u => u.energy), units.map(u => u.tension), units.map(u => u.density), "feature_film"
    );
    const vdLadder = analyzeLadder(
      units.map(u => u.energy), units.map(u => u.tension), units.map(u => u.density), "vertical_drama"
    );
    expect(featureLadder.peakLate25).toBe(false);
    expect(vdLadder.peakLate25).toBe(true);
  });
});
