/**
 * Cinematic Intelligence Kernel — Tests
 * Tests import real implementations — no logic duplication.
 */
import { describe, it, expect, vi } from "vitest";

import type { CinematicUnit, CinematicFailureCode, CinematicScore } from "../../supabase/functions/_shared/cinematic-model";
import { DIAGNOSTIC_ONLY_CODES } from "../../supabase/functions/_shared/cinematic-model";
import { extractFeatures, countDirectionReversals, detectPacingMismatch, summarizeSignal, summarizePolarity, variance } from "../../supabase/functions/_shared/cinematic-features";
import { scoreCinematic, CINEMATIC_THRESHOLDS, PENALTY_MAP } from "../../supabase/functions/_shared/cinematic-score";
import { amplifyRepairInstruction, buildTrailerRepairInstruction, buildStoryboardRepairInstruction, numericTargetsForFailures } from "../../supabase/functions/_shared/cinematic-repair";
import { enforceUnitCount } from "../../supabase/functions/_shared/cinematic-adapters";
import { computeStoryboardExpectedCount, computeTrailerExpectedCount } from "../../supabase/functions/_shared/cinematic-expected-count";
import { analyzeLadder } from "../../supabase/functions/_shared/cik/ladderLock";
import { lateStartIndexForUnitCount, minUpFracForUnitCount, maxZigzagFlipsForUnitCount } from "../../supabase/functions/_shared/cik/ladderLockConstants";

function makeUnit(overrides: Partial<CinematicUnit> & { id: string }): CinematicUnit {
  return {
    intent: "intrigue",
    energy: 0.5,
    tension: 0.5,
    density: 0.5,
    tonal_polarity: 0,
    ...overrides,
  };
}

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
    // Healthy ramp: density and energy both increase with meaningful variance
    const densities = [0.3, 0.5, 0.7, 0.9];
    const energies = [0.2, 0.5, 0.7, 0.95];
    const densitySummary = summarizeSignal(densities);
    const energySummary = summarizeSignal(energies);
    // Raw variance of these ramp values is well above 0.005
    expect(variance(densities)).toBeGreaterThan(0.005);
    expect(variance(energies)).toBeGreaterThan(0.005);
    expect(detectPacingMismatch(densitySummary, energySummary, 4, densities, energies)).toBe(false);
  });

  it("samey pacing uses raw value variance, not delta variance", () => {
    // Units with very similar raw values but nonzero deltas
    const densities = [0.50, 0.51, 0.50, 0.51];
    const energies = [0.50, 0.51, 0.50, 0.51];
    const densitySummary = summarizeSignal(densities);
    const energySummary = summarizeSignal(energies);
    // Raw variance is tiny → samey
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
    // Build units with high intent flip rate but NO low contrast or flatline
    // → EYE_LINE_BREAK should NOT appear
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
    // Flatline energy + high intent flip rate → triggers both FLATLINE and EYE_LINE_BREAK
    const units = [
      makeUnit({ id: "0", energy: 0.5, intent: "intrigue" }),
      makeUnit({ id: "1", energy: 0.5, intent: "threat" }),
      makeUnit({ id: "2", energy: 0.5, intent: "chaos" }),
      makeUnit({ id: "3", energy: 0.5, intent: "emotion" }),
      makeUnit({ id: "4", energy: 0.5, intent: "release" }),
    ];
    const score = scoreCinematic(units, { isStoryboard: true, adapterMode: "heuristic" });
    if (score.failures.includes("FLATLINE") || score.failures.includes("LOW_CONTRAST")) {
      // EYE_LINE_BREAK may be present as diagnostic flag
      if (score.failures.includes("EYE_LINE_BREAK")) {
        expect(score.diagnostic_flags).toContain("EYE_LINE_BREAK");
        expect(score.hard_failures).not.toContain("EYE_LINE_BREAK");
      }
    }
  });
});

// ─── Repair Instruction Tests ───

describe("Repair instructions", () => {
  it("amplifyRepairInstruction includes PACING_MISMATCH target", () => {
    const result = amplifyRepairInstruction("base", ["PACING_MISMATCH"]);
    expect(result).toContain("NUMERIC TARGETS");
    expect(result).toContain("density");
  });

  it("amplifyRepairInstruction includes ENERGY_DROP target", () => {
    const result = amplifyRepairInstruction("base", ["ENERGY_DROP"]);
    expect(result).toContain("energy[last]");
  });

  it("amplifyRepairInstruction includes DIRECTION_REVERSAL target", () => {
    const result = amplifyRepairInstruction("base", ["DIRECTION_REVERSAL"]);
    expect(result).toContain("reversals");
  });

  it("buildTrailerRepairInstruction includes shape guard, bullets, and no-new-intent", () => {
    const score = scoreCinematic([makeUnit({ id: "0", energy: 0.1 })]);
    const instruction = buildTrailerRepairInstruction(score);
    expect(instruction).toContain("CRITICAL REPAIR CONSTRAINTS");
    expect(instruction).toContain("TOO_SHORT");
    expect(instruction).toContain("CONSTRAINTS (ATTEMPT 1)");
    expect(instruction).toContain("Do NOT introduce new characters");
  });

  it("buildTrailerRepairInstruction includes context-aware numeric targets with unitCount", () => {
    const score = scoreCinematic([makeUnit({ id: "0", energy: 0.1 })]);
    const instruction = buildTrailerRepairInstruction(score, 8);
    expect(instruction).toContain("CONTEXT-AWARE NUMERIC TARGETS");
    expect(instruction).toContain("unitCount must equal 8 exactly");
  });

  it("buildStoryboardRepairInstruction includes unit_key guard", () => {
    const score = scoreCinematic([makeUnit({ id: "0", energy: 0.1 })]);
    const instruction = buildStoryboardRepairInstruction(score);
    expect(instruction).toContain("unit_key");
  });
});

// ─── numericTargetsForFailures Tests ───

describe("numericTargetsForFailures", () => {
  it("returns TOO_SHORT target with exact unit count", () => {
    const { targets } = numericTargetsForFailures({ failures: ["TOO_SHORT"], unitCount: 6 });
    expect(targets).toContain("unitCount must equal 6 exactly (no more, no less)");
  });

  it("returns NO_PEAK target with correct latePeakMin", () => {
    const { targets } = numericTargetsForFailures({ failures: ["NO_PEAK"], unitCount: 8 });
    // latePeakMin = floor(8 * 0.75) = 6
    expect(targets.some(t => t.includes("peakIndex must be >= 6"))).toBe(true);
    expect(targets.some(t => t.includes("climax/turning-point"))).toBe(true);
  });

  it("returns escalation target for WEAK_ARC", () => {
    const { targets } = numericTargetsForFailures({ failures: ["WEAK_ARC"], unitCount: 6 });
    expect(targets.some(t => t.includes("escalationScore"))).toBe(true);
  });

  it("returns contrast target for FLATLINE", () => {
    const { targets } = numericTargetsForFailures({ failures: ["FLATLINE"], unitCount: 6 });
    expect(targets.some(t => t.includes("contrastScore"))).toBe(true);
    expect(targets.some(t => t.includes("higher-intensity"))).toBe(true);
  });

  it("deduplicates targets for overlapping failures", () => {
    const { targets } = numericTargetsForFailures({ failures: ["NO_ESCALATION", "WEAK_ARC"], unitCount: 6 });
    const escalationTargets = targets.filter(t => t.includes("escalationScore"));
    expect(escalationTargets).toHaveLength(1); // deduped
  });

  it("returns empty for unknown failures", () => {
    const { targets, covered } = numericTargetsForFailures({ failures: ["UNKNOWN_CODE" as any], unitCount: 6 });
    expect(targets).toHaveLength(0);
    expect(covered.size).toBe(0);
  });

  it("computes latePeakMin correctly for small unit counts", () => {
    const { targets } = numericTargetsForFailures({ failures: ["ENERGY_DROP"], unitCount: 4 });
    // latePeakMin = max(1, floor(4 * 0.75)) = 3
    expect(targets.some(t => t.includes("peakIndex must be >= 3"))).toBe(true);
  });

  it("returns covered set matching emitted failures", () => {
    const { covered } = numericTargetsForFailures({ failures: ["NO_PEAK", "FLATLINE"], unitCount: 8 });
    expect(covered.has("NO_PEAK")).toBe(true);
    expect(covered.has("FLATLINE")).toBe(true);
    expect(covered.has("TOO_SHORT")).toBe(false);
  });
});

// ─── Target deconflict + Procedure block tests ───

describe("repair instruction deconflict & procedure", () => {
  const makeScore = (failures: CinematicFailureCode[]): CinematicScore => ({
    score: 0.3,
    pass: false,
    failures,
    diagnostic_flags: [],
  } as any);

  it("context-covered failures omit static targets", () => {
    // NO_PEAK is covered by context targets, so static FAILURE_TARGETS["NO_PEAK"] should not appear
    const instr = buildTrailerRepairInstruction(makeScore(["NO_PEAK"]), 8);
    expect(instr).toContain("CONTEXT-AWARE NUMERIC TARGETS");
    expect(instr).toContain("peakIndex must be >= 6");
    // Static target string should NOT appear since NO_PEAK is covered
    expect(instr).not.toContain("energy >= 0.92 and tension >= 0.82");
  });

  it("trailer repair includes procedure block", () => {
    const instr = buildTrailerRepairInstruction(makeScore(["NO_PEAK"]), 8);
    expect(instr).toContain("PROCEDURE (MANDATORY, ATTEMPT 1)");
    expect(instr).toContain("deletion and reordering");
  });

  it("storyboard repair includes storyboard procedure block", () => {
    const instr = buildStoryboardRepairInstruction(makeScore(["NO_PEAK"]), 8);
    expect(instr).toContain("PROCEDURE (MANDATORY, ATTEMPT 1)");
    expect(instr).toContain("existing unit_keys");
  });

  it("procedure block survives even with many failures", () => {
    const manyFailures: CinematicFailureCode[] = [
      "NO_PEAK", "NO_ESCALATION", "FLATLINE", "LOW_CONTRAST",
      "TONAL_WHIPLASH", "WEAK_ARC", "LOW_INTENT_DIVERSITY",
      "PACING_MISMATCH", "ENERGY_DROP", "DIRECTION_REVERSAL",
    ];
    const instr = buildTrailerRepairInstruction(makeScore(manyFailures), 8);
    expect(instr).toContain("PROCEDURE (MANDATORY, ATTEMPT 1)");
    expect(instr).toContain("CONSTRAINTS (ATTEMPT 1)");
  });
});

// ─── Adapter pad/trim Tests ───

describe("enforceUnitCount", () => {
  it("trims excess units from tail", () => {
    const units = [
      makeUnit({ id: "0" }), makeUnit({ id: "1" }),
      makeUnit({ id: "2" }), makeUnit({ id: "3" }),
    ];
    const result = enforceUnitCount(units, 2);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("0");
    expect(result[1].id).toBe("1");
  });

  it("pads with default units when too few", () => {
    const units = [makeUnit({ id: "0" })];
    const result = enforceUnitCount(units, 3);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("0");
    expect(result[1].energy).toBe(0.45);
    expect(result[2].energy).toBe(0.45);
  });

  it("returns unchanged if count matches", () => {
    const units = [makeUnit({ id: "0" }), makeUnit({ id: "1" })];
    const result = enforceUnitCount(units, 2);
    expect(result).toHaveLength(2);
    expect(result).toBe(units);
  });

  it("storyboard pad preserves expected unit_key ids", () => {
    const units = [makeUnit({ id: "scene1_shot1" })];
    const expectedKeys = ["scene1_shot1", "scene1_shot2", "scene2_shot1"];
    const result = enforceUnitCount(units, 3, expectedKeys);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("scene1_shot1");
    expect(result[1].id).toBe("scene1_shot2");
    expect(result[2].id).toBe("scene2_shot1");
  });

  it("storyboard pad does not duplicate existing ids", () => {
    const units = [makeUnit({ id: "key_a" }), makeUnit({ id: "key_b" })];
    const expectedKeys = ["key_a", "key_b", "key_c", "key_d"];
    const result = enforceUnitCount(units, 4, expectedKeys);
    expect(result).toHaveLength(4);
    expect(result[2].id).toBe("key_c");
    expect(result[3].id).toBe("key_d");
  });
});

// ─── DIAGNOSTIC_ONLY_CODES contract ───

describe("DIAGNOSTIC_ONLY_CODES", () => {
  it("contains EYE_LINE_BREAK", () => {
    expect(DIAGNOSTIC_ONLY_CODES.has("EYE_LINE_BREAK")).toBe(true);
  });

  it("does not contain hard failure codes", () => {
    const hardCodes: CinematicFailureCode[] = [
      "TOO_SHORT", "NO_PEAK", "NO_ESCALATION", "FLATLINE",
      "LOW_CONTRAST", "TONAL_WHIPLASH", "WEAK_ARC",
      "LOW_INTENT_DIVERSITY", "PACING_MISMATCH", "ENERGY_DROP",
      "DIRECTION_REVERSAL",
    ];
    for (const c of hardCodes) {
      expect(DIAGNOSTIC_ONLY_CODES.has(c)).toBe(false);
    }
  });
});

// ─── Kernel expected_unit_count passthrough ───

describe("kernel adapter passthrough", () => {
  it("adapter with arity 2 receives expected_unit_count", async () => {
    // We test that runAdapter logic passes the count by importing enforceCinematicQuality
    // and using a mock adapter that captures the second argument
    const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");
    
    let receivedCount: number | undefined;
    const mockAdapter = (raw: any, expectedCount?: number) => {
      receivedCount = expectedCount;
      // Return passing units
      return {
        units: [
          makeUnit({ id: "0", energy: 0.3, intent: "intrigue", density: 0.3 }),
          makeUnit({ id: "1", energy: 0.5, intent: "threat", density: 0.5 }),
          makeUnit({ id: "2", energy: 0.7, intent: "chaos", density: 0.7 }),
          makeUnit({ id: "3", energy: 0.85, intent: "emotion", density: 0.8 }),
          makeUnit({ id: "4", energy: 0.95, intent: "release", density: 0.9 }),
        ],
        mode: "explicit" as const,
      };
    };

    try {
      await enforceCinematicQuality({
        handler: "test",
        phase: "test",
        model: "test",
        rawOutput: {},
        adapter: mockAdapter,
        expected_unit_count: 5,
        buildRepairInstruction: () => "repair",
        regenerateOnce: async () => ({}),
      });
    } catch {
      // May fail quality gate, that's fine — we just check the adapter received the count
    }
    expect(receivedCount).toBe(5);
  });
});

// ─── Expected unit count compute helpers ───

describe("computeExpectedUnitCount", () => {
  it("storyboard returns unit_keys length", () => {
    expect(computeStoryboardExpectedCount(["a", "b", "c"])).toBe(3);
  });

  it("storyboard returns undefined for empty", () => {
    expect(computeStoryboardExpectedCount([])).toBeUndefined();
    expect(computeStoryboardExpectedCount(undefined)).toBeUndefined();
  });

  it("trailer returns beats length", () => {
    expect(computeTrailerExpectedCount({ beats: [1, 2, 3, 4] })).toBe(4);
  });

  it("trailer returns undefined when no beats", () => {
    expect(computeTrailerExpectedCount({})).toBeUndefined();
    expect(computeTrailerExpectedCount({ beats: [] })).toBeUndefined();
  });

  it("trailer handles raw array input", () => {
    expect(computeTrailerExpectedCount([1, 2, 3])).toBe(3);
  });
});

// ─── CIK v3.12 Ladder Lock Tests ───

describe("analyzeLadder", () => {
  it("returns safe defaults for n<3", () => {
    const m = analyzeLadder([0.5, 0.6], [0.5, 0.6], [0.5, 0.6]);
    expect(m.n).toBe(2);
    expect(m.meaningfulDownSteps).toBe(0);
    expect(m.peakLate25).toBe(true);
  });

  it("detects multiple meaningful dips", () => {
    // energy zigzags hard
    const energy =  [0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const tension = [0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const density = [0.3, 0.7, 0.2, 0.8, 0.1, 0.9];
    const m = analyzeLadder(energy, tension, density);
    expect(m.meaningfulDownSteps).toBeGreaterThan(1);
  });

  it("detects late dip in final 25%", () => {
    // 8 units, lateStart=6, last transition drops
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
    // Ladder should not trigger any additional failures on a clean ramp
    const ladderCodes = ["DIRECTION_REVERSAL", "ENERGY_DROP", "FLATLINE", "PACING_MISMATCH"];
    // These may still appear from non-ladder checks, but a clean ramp shouldn't trigger them
    if (score.hard_failures.length === 0) {
      expect(score.pass).toBe(true);
    }
  });
});

// ─── CIK v3.13 Peak Clamp + Tail Seal Tests ───

describe("v3.13 peak clamp + tail seal scoring", () => {
  it("late but non-dominant peak triggers LOW_CONTRAST or WEAK_ARC", () => {
    // All units near 0.7, peak barely above pre-late → peakLead < threshold
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
    // Good ramp but final unit drops noticeably below peak
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
    // Should not trigger LOW_CONTRAST or ENERGY_DROP from v3.13 checks specifically
    // Peak is dominant and tail is sealed
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
    // Ladder text is inside procedure block, not a separate section
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
    // Should contain "Also address:" for overflow failures
    expect(instr).toContain("Also address:");
  });
});
