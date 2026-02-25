/**
 * CIK — Integration Tests (Button Ending, Role Lock, Lane Propagation, Engine Boundary,
 * Adapter Sanitization, Repair Validation, Tuning, New Lanes)
 * Split from cinematic-features.test.ts (lines 974–1653). No logic changes.
 */
import { describe, it, expect } from "vitest";

import type { CinematicFailureCode, CinematicScore } from "../../supabase/functions/_shared/cinematic-model";
import { scoreCinematic } from "../../supabase/functions/_shared/cinematic-score";
import { buildTrailerRepairInstruction, buildStoryboardRepairInstruction } from "../../supabase/functions/_shared/cinematic-repair";
import { analyzeIntentSequencing, classifyIntent } from "../../supabase/functions/_shared/cinematic-features";
import { analyzeLadder } from "../../supabase/functions/_shared/cik/ladderLock";
import { lateStartIndexForUnitCount } from "../../supabase/functions/_shared/cik/ladderLockConstants";
import { buildEngineOpts } from "../../supabase/functions/_shared/cik/buildEngineOpts";
import { getCinematicThresholds } from "../../supabase/functions/_shared/cik/thresholdProfiles";
import { makeUnit } from "./helpers/cinematic-test-utils";

// ─── CIK v4.3 Button Ending Tests ───

describe("v4.3 button ending", () => {
  function makeButtonUnits(finalIntent: string) {
    return [
      makeUnit({ id: "0", energy: 0.3, tension: 0.3, density: 0.3, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, tension: 0.5, density: 0.5, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.7, tension: 0.7, density: 0.7, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.9, tension: 0.9, density: 0.9, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.92, tension: 0.92, density: 0.92, tonal_polarity: 0.5, intent: finalIntent as any }),
    ];
  }

  it("classifyIntent maps correctly", () => {
    expect(classifyIntent("intrigue")).toBe("early");
    expect(classifyIntent("wonder")).toBe("early");
    expect(classifyIntent("setup")).toBe("early");
    expect(classifyIntent("threat")).toBe("mid");
    expect(classifyIntent("chaos")).toBe("mid");
    expect(classifyIntent("release")).toBe("late");
    expect(classifyIntent("emotion")).toBe("late");
    expect(classifyIntent("climax")).toBe("late");
    expect(classifyIntent("reveal")).toBe("late");
    expect(classifyIntent("unknown_thing")).toBe("other");
  });

  it("vertical_drama: ending with intrigue triggers WEAK_ARC", () => {
    const units = makeButtonUnits("intrigue");
    const score = scoreCinematic(units, { lane: "vertical_drama" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("series: ending with threat (mid) triggers WEAK_ARC", () => {
    const units = makeButtonUnits("threat");
    const score = scoreCinematic(units, { lane: "series" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("documentary: ending with emotion does NOT trigger button WEAK_ARC", () => {
    const units = makeButtonUnits("emotion");
    const seq = analyzeIntentSequencing(units, "documentary");
    expect(seq.finalIsButton).toBe(true);
  });

  it("documentary: button rule isolates — emotion vs intrigue flips WEAK_ARC", () => {
    function makeCleanRamp(finalIntent: string) {
      return [
        makeUnit({ id: "0", energy: 0.40, tension: 0.40, density: 0.40, tonal_polarity: -0.2, intent: "intrigue" }),
        makeUnit({ id: "1", energy: 0.55, tension: 0.55, density: 0.50, tonal_polarity: -0.1, intent: "threat" }),
        makeUnit({ id: "2", energy: 0.70, tension: 0.70, density: 0.60, tonal_polarity: 0.0, intent: "chaos" }),
        makeUnit({ id: "3", energy: 0.85, tension: 0.85, density: 0.70, tonal_polarity: 0.2, intent: "emotion" }),
        makeUnit({ id: "4", energy: 0.90, tension: 0.90, density: 0.75, tonal_polarity: 0.3, intent: "release" }),
        makeUnit({ id: "5", energy: 0.92, tension: 0.92, density: 0.80, tonal_polarity: 0.4, intent: finalIntent as any }),
      ];
    }

    const emotionScore = scoreCinematic(makeCleanRamp("emotion"), { lane: "documentary" });
    const intrigueScore = scoreCinematic(makeCleanRamp("intrigue"), { lane: "documentary" });

    const emotionHasWeak = emotionScore.failures.includes("WEAK_ARC");
    const intrigueHasWeak = intrigueScore.failures.includes("WEAK_ARC");

    expect(intrigueHasWeak).toBe(true);
    expect(emotionHasWeak).toBe(false);
  });

  it("documentary: ending with intrigue triggers WEAK_ARC", () => {
    const units = makeButtonUnits("intrigue");
    const score = scoreCinematic(units, { lane: "documentary" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("feature_film: ending with intrigue triggers WEAK_ARC", () => {
    const units = makeButtonUnits("intrigue");
    const score = scoreCinematic(units, { lane: "feature_film" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("feature_film: ending with emotion does NOT trigger button WEAK_ARC", () => {
    const units = makeButtonUnits("emotion");
    const seq = analyzeIntentSequencing(units, "feature_film");
    expect(seq.finalIntentClass).toBe("late");
  });

  it("repair prompt includes BUTTON ENDING and stays <= 2500", () => {
    const score: CinematicScore = {
      score: 0.3, pass: false,
      failures: ["WEAK_ARC"] as CinematicFailureCode[],
      hard_failures: ["WEAK_ARC"] as CinematicFailureCode[],
      diagnostic_flags: [], penalty_breakdown: [], metrics: {} as any,
    };
    const instr = buildTrailerRepairInstruction(score, 6);
    expect(instr).toContain("BUTTON ENDING");
    expect(instr.length).toBeLessThanOrEqual(2500);
  });
});

// ─── CIK v4.4 Unit Role Lock Tests ───

describe("v4.4 unit role lock", () => {
  function makeRoleLockUnits(intents: string[]) {
    return intents.map((intent, i) => makeUnit({
      id: `${i}`,
      energy: 0.35 + i * 0.12,
      tension: 0.35 + i * 0.12,
      density: 0.35 + i * 0.08,
      tonal_polarity: -0.2 + i * 0.15,
      intent: intent as any,
    }));
  }

  it("feature_film: early window dominated by MID triggers WEAK_ARC", () => {
    const units = makeRoleLockUnits(["threat", "chaos", "chaos", "threat", "emotion", "release"]);
    const score = scoreCinematic(units, { lane: "feature_film" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("series: last 2 units not LATE triggers WEAK_ARC", () => {
    const units = makeRoleLockUnits(["intrigue", "threat", "chaos", "emotion", "threat", "release"]);
    const score = scoreCinematic(units, { lane: "series" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("vertical_drama: first unit MID triggers WEAK_ARC", () => {
    const units = makeRoleLockUnits(["threat", "threat", "chaos", "emotion", "emotion", "release"]);
    const score = scoreCinematic(units, { lane: "vertical_drama" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("vertical_drama: last unit not LATE triggers WEAK_ARC", () => {
    const units = makeRoleLockUnits(["intrigue", "threat", "chaos", "emotion", "release", "intrigue"]);
    const score = scoreCinematic(units, { lane: "vertical_drama" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("documentary: EARLY intent in final 30% triggers WEAK_ARC", () => {
    const units = makeRoleLockUnits(["intrigue", "threat", "chaos", "emotion", "intrigue", "release"]);
    const score = scoreCinematic(units, { lane: "documentary" });
    expect(score.failures).toContain("WEAK_ARC");
  });

  it("clean sequence does not add role lock failures", () => {
    const units = makeRoleLockUnits(["intrigue", "wonder", "threat", "chaos", "emotion", "release"]);
    const score = scoreCinematic(units, { lane: "feature_film" });
    const seq = analyzeIntentSequencing(units, "feature_film");
    expect(seq.roleMismatchCountEarly).toBe(0);
    expect(seq.roleMismatchCountMid).toBeLessThanOrEqual(1);
    expect(seq.roleMismatchCountLate).toBe(0);
    expect(seq.lateHasEarlyIntent).toBe(false);
  });

  it("repair prompt contains UNIT ROLE LOCK and stays <= 2500", () => {
    const score: CinematicScore = {
      score: 0.3, pass: false,
      failures: ["WEAK_ARC", "PACING_MISMATCH"] as CinematicFailureCode[],
      hard_failures: ["WEAK_ARC", "PACING_MISMATCH"] as CinematicFailureCode[],
      diagnostic_flags: [], penalty_breakdown: [], metrics: {} as any,
    };
    const instr = buildTrailerRepairInstruction(score, 6);
    expect(instr).toContain("UNIT ROLE LOCK");
    expect(instr.length).toBeLessThanOrEqual(2500);
  });
});

// ─── Lane Propagation Integration Tests ───

describe("lane propagation end-to-end", () => {
  function makeBorderlineRamp() {
    return [
      makeUnit({ id: "0", energy: 0.35, tension: 0.35, density: 0.35, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.45, tension: 0.45, density: 0.40, tonal_polarity: -0.2, intent: "wonder" }),
      makeUnit({ id: "2", energy: 0.60, tension: 0.60, density: 0.50, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "3", energy: 0.72, tension: 0.72, density: 0.60, tonal_polarity: 0.0, intent: "chaos" }),
      makeUnit({ id: "4", energy: 0.93, tension: 0.93, density: 0.75, tonal_polarity: 0.2, intent: "emotion" }),
      makeUnit({ id: "5", energy: 0.90, tension: 0.90, density: 0.78, tonal_polarity: 0.3, intent: "release" }),
      makeUnit({ id: "6", energy: 0.91, tension: 0.91, density: 0.80, tonal_polarity: 0.4, intent: "release" }),
    ];
  }

  it("vertical_drama uses stricter late window than feature_film", () => {
    const units = makeBorderlineRamp();
    const vdLadder = analyzeLadder(
      units.map(u => u.energy), units.map(u => u.tension), units.map(u => u.density), "vertical_drama"
    );
    const ffLadder = analyzeLadder(
      units.map(u => u.energy), units.map(u => u.tension), units.map(u => u.density), "feature_film"
    );
    expect(vdLadder.peakLate25).toBe(true);
    expect(ffLadder.peakLate25).toBe(false);
  });

  it("documentary uses softer thresholds via lane-aware profiles", () => {
    const docThresholds = getCinematicThresholds("documentary");
    const defaultThresholds = getCinematicThresholds(undefined);
    expect(docThresholds.min_contrast).toBeLessThanOrEqual(defaultThresholds.min_contrast);
  });

  it("unknown lane preserves exact default behavior", () => {
    const units = makeBorderlineRamp();
    const unknownScore = scoreCinematic(units, { lane: "some_unknown_lane" });
    const noLaneScore = scoreCinematic(units, {});
    expect(unknownScore.failures.sort()).toEqual(noLaneScore.failures.sort());
    expect(unknownScore.score).toBe(noLaneScore.score);
  });

  it("repair instruction threads lane to numericTargets", () => {
    const score: CinematicScore = {
      score: 0.3, pass: false,
      failures: ["WEAK_ARC", "ENERGY_DROP"] as CinematicFailureCode[],
      hard_failures: ["WEAK_ARC", "ENERGY_DROP"] as CinematicFailureCode[],
      diagnostic_flags: [], penalty_breakdown: [], metrics: {} as any,
    };
    const instrVD = buildTrailerRepairInstruction(score, 8, "vertical_drama");
    expect(instrVD).toContain("Peak units 6");
    const instrFF = buildTrailerRepairInstruction(score, 8, "feature_film");
    expect(instrFF).toContain("Peak units 7");
    expect(instrVD.length).toBeLessThanOrEqual(2500);
    expect(instrFF.length).toBeLessThanOrEqual(2500);
  });
});

// ─── End-to-End Kernel Boundary Tests ───

describe("enforceCinematicQuality lane propagation (kernel boundary)", () => {
  it("lane flows from opts through scoring → repair instruction (vertical_drama vs feature_film)", async () => {
    const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");

    const failingUnits = [
      makeUnit({ id: "0", energy: 0.30, tension: 0.30, density: 0.30, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.40, tension: 0.40, density: 0.35, tonal_polarity: -0.2, intent: "wonder" }),
      makeUnit({ id: "2", energy: 0.50, tension: 0.50, density: 0.40, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "3", energy: 0.60, tension: 0.60, density: 0.50, tonal_polarity: 0.0, intent: "chaos" }),
      makeUnit({ id: "4", energy: 0.70, tension: 0.70, density: 0.55, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "5", energy: 0.92, tension: 0.92, density: 0.70, tonal_polarity: 0.2, intent: "emotion" }),
      makeUnit({ id: "6", energy: 0.88, tension: 0.88, density: 0.72, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "7", energy: 0.89, tension: 0.89, density: 0.75, tonal_polarity: 0.4, intent: "release" }),
    ];
    const rawOutput = { beats: failingUnits };

    const adapter = (raw: any) => ({
      units: raw.beats as any[],
      mode: "explicit" as const,
    });

    const capturedInstructions: Record<string, string> = {};

    for (const lane of ["vertical_drama", "feature_film"] as const) {
      let capturedInstruction = "";

      try {
        await enforceCinematicQuality({
          handler: "test",
          phase: "lane_propagation_test",
          model: "test",
          rawOutput,
          adapter,
          buildRepairInstruction: (score, unitCount, laneArg) => {
            capturedInstruction = buildTrailerRepairInstruction(score, unitCount, laneArg);
            return capturedInstruction;
          },
          regenerateOnce: async (_instruction: string) => {
            return rawOutput;
          },
          telemetry: () => {},
          expected_unit_count: 8,
          lane,
        });
      } catch (err: any) {
        expect(err.type).toBe("AI_CINEMATIC_QUALITY_FAIL");
      }

      capturedInstructions[lane] = capturedInstruction;
    }

    expect(capturedInstructions["vertical_drama"]).toContain("Peak units 6");
    expect(capturedInstructions["feature_film"]).toContain("Peak units 7");

    expect(capturedInstructions["vertical_drama"].length).toBeLessThanOrEqual(2500);
    expect(capturedInstructions["feature_film"].length).toBeLessThanOrEqual(2500);
  });

  describe("engine boundary: assigned_lane → opts.lane → repair laneArg", () => {
    it("buildEngineOpts reads project.assigned_lane and kernel threads it into repair instruction", async () => {
      const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");

      const failingUnits = [
        makeUnit({ id: "0", energy: 0.30, tension: 0.30, density: 0.30, tonal_polarity: -0.3, intent: "intrigue" }),
        makeUnit({ id: "1", energy: 0.40, tension: 0.40, density: 0.35, tonal_polarity: -0.2, intent: "wonder" }),
        makeUnit({ id: "2", energy: 0.50, tension: 0.50, density: 0.40, tonal_polarity: -0.1, intent: "threat" }),
        makeUnit({ id: "3", energy: 0.60, tension: 0.60, density: 0.50, tonal_polarity: 0.0, intent: "chaos" }),
        makeUnit({ id: "4", energy: 0.70, tension: 0.70, density: 0.55, tonal_polarity: 0.1, intent: "chaos" }),
        makeUnit({ id: "5", energy: 0.92, tension: 0.92, density: 0.70, tonal_polarity: 0.2, intent: "emotion" }),
        makeUnit({ id: "6", energy: 0.88, tension: 0.88, density: 0.72, tonal_polarity: 0.3, intent: "emotion" }),
        makeUnit({ id: "7", energy: 0.89, tension: 0.89, density: 0.75, tonal_polarity: 0.4, intent: "release" }),
      ];
      const rawOutput = { beats: failingUnits };

      const project = { id: "test-project", assigned_lane: "vertical_drama" };

      let capturedLaneArg: string | undefined;
      let capturedInstruction = "";

      const opts = buildEngineOpts({
        handler: "trailer-cinematic-engine",
        phase: "engine_boundary_test",
        model: "test",
        project,
        rawOutput,
        adapter: (raw: any) => ({
          units: raw.beats as any[],
          mode: "explicit" as const,
        }),
        buildRepairInstruction: (score, unitCount, laneArg) => {
          capturedLaneArg = laneArg;
          capturedInstruction = buildTrailerRepairInstruction(score, unitCount, laneArg);
          return capturedInstruction;
        },
        regenerateOnce: async () => rawOutput,
        expected_unit_count: 8,
      });

      expect(opts.lane).toBe("vertical_drama");

      opts.telemetry = () => {};
      try {
        await enforceCinematicQuality(opts);
      } catch (err: any) {
        expect(err.type).toBe("AI_CINEMATIC_QUALITY_FAIL");
      }

      expect(capturedLaneArg).toBe("vertical_drama");
      expect(capturedInstruction).toContain("Peak units 6");

      const noLaneOpts = buildEngineOpts({
        handler: "test",
        phase: "test",
        model: "test",
        project: { assigned_lane: null },
        rawOutput,
        adapter: (raw: any) => ({ units: raw.beats as any[], mode: "explicit" as const }),
        buildRepairInstruction: buildTrailerRepairInstruction,
        regenerateOnce: async () => rawOutput,
      });
      expect(noLaneOpts.lane).toBeUndefined();
    });
  });

  describe("storyboard engine boundary: assigned_lane → opts.lane → repair laneArg", () => {
    it("buildEngineOpts (isStoryboard) reads project.assigned_lane and kernel threads it into storyboard repair instruction", async () => {
      const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");

      const failingPanels = [
        makeUnit({ id: "p0", energy: 0.30, tension: 0.30, density: 0.30, tonal_polarity: -0.3, intent: "intrigue" }),
        makeUnit({ id: "p1", energy: 0.40, tension: 0.40, density: 0.35, tonal_polarity: -0.2, intent: "wonder" }),
        makeUnit({ id: "p2", energy: 0.50, tension: 0.50, density: 0.40, tonal_polarity: -0.1, intent: "threat" }),
        makeUnit({ id: "p3", energy: 0.60, tension: 0.60, density: 0.50, tonal_polarity: 0.0, intent: "chaos" }),
        makeUnit({ id: "p4", energy: 0.70, tension: 0.70, density: 0.55, tonal_polarity: 0.1, intent: "chaos" }),
        makeUnit({ id: "p5", energy: 0.92, tension: 0.92, density: 0.70, tonal_polarity: 0.2, intent: "emotion" }),
        makeUnit({ id: "p6", energy: 0.88, tension: 0.88, density: 0.72, tonal_polarity: 0.3, intent: "emotion" }),
        makeUnit({ id: "p7", energy: 0.89, tension: 0.89, density: 0.75, tonal_polarity: 0.4, intent: "release" }),
      ];
      const rawOutput = { panels: failingPanels };

      const project = { id: "test-project", assigned_lane: "vertical_drama" };

      let capturedLaneArg: string | undefined;
      let capturedInstruction = "";

      const opts = buildEngineOpts({
        handler: "storyboard-engine",
        phase: "storyboard_boundary_test",
        model: "test",
        project,
        rawOutput,
        adapter: (raw: any) => ({
          units: raw.panels as any[],
          mode: "explicit" as const,
        }),
        buildRepairInstruction: (score, unitCount, laneArg) => {
          capturedLaneArg = laneArg;
          capturedInstruction = buildStoryboardRepairInstruction(score, unitCount, laneArg);
          return capturedInstruction;
        },
        regenerateOnce: async () => rawOutput,
        expected_unit_count: 8,
        isStoryboard: true,
      });

      expect(opts.lane).toBe("vertical_drama");
      expect(opts.isStoryboard).toBe(true);

      opts.telemetry = () => {};
      try {
        await enforceCinematicQuality(opts);
      } catch (err: any) {
        expect(err.type).toBe("AI_CINEMATIC_QUALITY_FAIL");
      }

      expect(capturedLaneArg).toBe("vertical_drama");
      expect(capturedInstruction).toContain("Peak units 6");

      const noLaneOpts = buildEngineOpts({
        handler: "test",
        phase: "test",
        model: "test",
        project: { assigned_lane: null },
        rawOutput,
        adapter: (raw: any) => ({ units: raw.panels as any[], mode: "explicit" as const }),
        buildRepairInstruction: buildStoryboardRepairInstruction,
        regenerateOnce: async () => rawOutput,
        isStoryboard: true,
      });
      expect(noLaneOpts.lane).toBeUndefined();
    });
  });
});

// ─── Adapter Sanitization Tests ───

describe("adapter sanitization", () => {
  it("clamps out-of-range numerics without changing valid units", async () => {
    const { sanitizeUnits } = await import("../../supabase/functions/_shared/cik/adapterSanitize");
    const validUnit = makeUnit({ id: "v", energy: 0.5, tension: 0.6, density: 0.7, tonal_polarity: 0.1, intent: "chaos" });
    const { units, quality } = sanitizeUnits([validUnit]);
    expect(units[0].energy).toBe(0.5);
    expect(units[0].tension).toBe(0.6);
    expect(units[0].density).toBe(0.7);
    expect(units[0].intent).toBe("chaos");
    expect(quality.missing_energy).toBe(0);
    expect(quality.out_of_range_clamped).toBe(0);
    expect(quality.percent_defaulted_fields).toBe(0);
  });

  it("defaults missing numeric fields and invalid intents", async () => {
    const { sanitizeUnits } = await import("../../supabase/functions/_shared/cik/adapterSanitize");
    const broken = { id: "b", intent: "invalid_intent", energy: null, tension: undefined, density: NaN, tonal_polarity: 0.2 } as any;
    const { units, quality } = sanitizeUnits([broken]);
    expect(units[0].energy).toBe(0.45);
    expect(units[0].tension).toBe(0.45);
    expect(units[0].density).toBe(0.45);
    expect(units[0].intent).toBe("intrigue");
    expect(quality.missing_energy).toBe(1);
    expect(quality.missing_tension).toBe(1);
    expect(quality.missing_density).toBe(1);
    expect(quality.missing_intent).toBe(1);
    expect(quality.percent_defaulted_fields).toBe(1);
  });

  it("clamps energy > 1 and tension < 0", async () => {
    const { sanitizeUnits } = await import("../../supabase/functions/_shared/cik/adapterSanitize");
    const oob = makeUnit({ id: "o", energy: 1.5, tension: -0.3, density: 0.5, tonal_polarity: 0.0, intent: "threat" });
    const { units, quality } = sanitizeUnits([oob]);
    expect(units[0].energy).toBe(1.0);
    expect(units[0].tension).toBe(0.0);
    expect(quality.out_of_range_clamped).toBe(2);
  });

  it("adapter quality metrics appear in telemetry payload", async () => {
    const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");
    const units = [
      makeUnit({ id: "0", energy: 0.9, tension: 0.9, density: 0.8, tonal_polarity: 0.0, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.91, tension: 0.91, density: 0.81, tonal_polarity: 0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.92, tension: 0.92, density: 0.82, tonal_polarity: 0.2, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.93, tension: 0.93, density: 0.83, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.9, tonal_polarity: 0.4, intent: "release" }),
    ];
    const captured: any[] = [];
    try {
      await enforceCinematicQuality({
        handler: "test", phase: "test", model: "test",
        rawOutput: { beats: units },
        adapter: (raw: any) => ({ units: raw.beats, mode: "explicit" as const }),
        buildRepairInstruction: buildTrailerRepairInstruction,
        regenerateOnce: async () => ({ beats: units }),
        telemetry: (_name: string, payload: any) => captured.push(payload),
      });
    } catch {
      // May throw AI_CINEMATIC_QUALITY_FAIL — telemetry still captured
    }
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0].adapter_quality).toBeDefined();
    expect(captured[0].adapter_quality.extracted_unit_count).toBe(5);
    expect(captured[0].adapter_quality.missing_energy).toBe(0);
  });
});

// ─── Repair Validation Telemetry Tests ───

describe("repair validation telemetry", () => {
  it("logs before/after failure deltas on repair attempt", async () => {
    const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");
    const failingUnits = [
      makeUnit({ id: "0", energy: 0.30, tension: 0.30, density: 0.30, tonal_polarity: -0.3, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.40, tension: 0.40, density: 0.35, tonal_polarity: -0.2, intent: "wonder" }),
      makeUnit({ id: "2", energy: 0.50, tension: 0.50, density: 0.40, tonal_polarity: -0.1, intent: "threat" }),
      makeUnit({ id: "3", energy: 0.60, tension: 0.60, density: 0.50, tonal_polarity: 0.0, intent: "chaos" }),
      makeUnit({ id: "4", energy: 0.70, tension: 0.70, density: 0.55, tonal_polarity: 0.1, intent: "chaos" }),
      makeUnit({ id: "5", energy: 0.92, tension: 0.92, density: 0.70, tonal_polarity: 0.2, intent: "emotion" }),
      makeUnit({ id: "6", energy: 0.88, tension: 0.88, density: 0.72, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "7", energy: 0.89, tension: 0.89, density: 0.75, tonal_polarity: 0.4, intent: "release" }),
    ];

    const originalError = console.error;
    const errorLogs: string[] = [];
    console.error = (msg: any) => { errorLogs.push(typeof msg === "string" ? msg : JSON.stringify(msg)); };

    try {
      await enforceCinematicQuality({
        handler: "test", phase: "repair_val_test", model: "test",
        rawOutput: { beats: failingUnits },
        adapter: (raw: any) => ({ units: raw.beats, mode: "explicit" as const }),
        buildRepairInstruction: buildTrailerRepairInstruction,
        regenerateOnce: async () => ({ beats: failingUnits }),
        telemetry: () => {},
        expected_unit_count: 8,
      });
    } catch (err: any) {
      expect(err.type).toBe("AI_CINEMATIC_QUALITY_FAIL");
    }

    console.error = originalError;

    const repairLog = errorLogs.find(l => l.includes("CINEMATIC_REPAIR_VALIDATION"));
    expect(repairLog).toBeDefined();
    const parsed = JSON.parse(repairLog!);
    expect(parsed.type).toBe("CINEMATIC_REPAIR_VALIDATION");
    expect(parsed.attempt_before_failures).toBeDefined();
    expect(parsed.attempt_after_failures).toBeDefined();
    expect(typeof parsed.failure_delta_count).toBe("number");
    expect(typeof parsed.score_delta).toBe("number");
    expect(typeof parsed.score_before).toBe("number");
    expect(typeof parsed.score_after).toBe("number");
  });
});

// ─── Tuning Hooks Tests ───

describe("tuning hooks", () => {
  it("defaults unchanged when tuning not set", async () => {
    const { applyTuningMul, clearTuning } = await import("../../supabase/functions/_shared/cik/tuning");
    clearTuning();
    expect(applyTuningMul(0.06, "vertical_drama", "tailSlackMul")).toBe(0.06);
    expect(applyTuningMul(0.10, undefined, "peakLeadThresholdMul")).toBe(0.10);
  });

  it("setting tuning override changes metric deterministically", async () => {
    const { setTuning, applyTuningMul, clearTuning } = await import("../../supabase/functions/_shared/cik/tuning");
    clearTuning();
    setTuning("vertical_drama", { tailSlackMul: 0.5 });
    expect(applyTuningMul(0.06, "vertical_drama", "tailSlackMul")).toBe(0.03);
    expect(applyTuningMul(0.06, "feature_film", "tailSlackMul")).toBe(0.06);
    clearTuning();
  });

  it("lateStartRatioOverride replaces rather than multiplies", async () => {
    const { setTuning, applyTuningMul, clearTuning } = await import("../../supabase/functions/_shared/cik/tuning");
    clearTuning();
    setTuning("advertising", { lateStartRatioOverride: 0.70 });
    expect(applyTuningMul(0.65, "advertising", "lateStartRatioOverride")).toBe(0.70);
    clearTuning();
  });
});

// ─── New Lane Profiles Tests ───

describe("new lane profiles (advertising, music_video)", () => {
  it("advertising uses stricter peak and lower min_units", () => {
    const t = getCinematicThresholds("advertising");
    expect(t.min_units).toBe(3);
    expect(t.min_peak_energy).toBe(0.92);
    expect(t.energy_drop_threshold).toBe(0.08);
  });

  it("music_video uses relaxed intent and tonal rules", () => {
    const t = getCinematicThresholds("music_video");
    expect(t.min_intent_distinct).toBe(2);
    expect(t.max_tonal_flips).toBe(4);
    expect(t.max_direction_reversals).toBe(5);
  });

  it("advertising lateStart uses 0.65 ratio", () => {
    expect(lateStartIndexForUnitCount(8, "advertising")).toBe(Math.floor(0.65 * 8));
  });

  it("music_video lateStart uses 0.60 ratio", () => {
    expect(lateStartIndexForUnitCount(8, "music_video")).toBe(Math.floor(0.60 * 8));
  });

  it("unknown lane equals exact defaults", () => {
    const unknown = getCinematicThresholds("totally_unknown");
    const defaults = getCinematicThresholds(undefined);
    expect(unknown).toEqual(defaults);
  });

  it("lane in telemetry event", async () => {
    const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");
    const units = [
      makeUnit({ id: "0", energy: 0.9, tension: 0.9, density: 0.8, tonal_polarity: 0.0, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.91, tension: 0.91, density: 0.81, tonal_polarity: 0.1, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.92, tension: 0.92, density: 0.82, tonal_polarity: 0.2, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.93, tension: 0.93, density: 0.83, tonal_polarity: 0.3, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.95, tension: 0.95, density: 0.9, tonal_polarity: 0.4, intent: "release" }),
    ];
    const captured: any[] = [];
    try {
      await enforceCinematicQuality({
        handler: "test", phase: "test", model: "test",
        rawOutput: { beats: units },
        adapter: (raw: any) => ({ units: raw.beats, mode: "explicit" as const }),
        buildRepairInstruction: buildTrailerRepairInstruction,
        regenerateOnce: async () => ({ beats: units }),
        telemetry: (_name: string, payload: any) => captured.push(payload),
        lane: "advertising",
      });
    } catch {
      // May throw AI_CINEMATIC_QUALITY_FAIL
    }
    expect(captured[0].lane).toBe("advertising");
  });
});
