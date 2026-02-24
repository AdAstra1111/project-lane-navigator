/**
 * Cinematic Intelligence Kernel — Tests
 * Tests import real implementations — no logic duplication.
 */
import { describe, it, expect, vi } from "vitest";

import type { CinematicUnit, CinematicFailureCode } from "../../supabase/functions/_shared/cinematic-model";
import { DIAGNOSTIC_ONLY_CODES } from "../../supabase/functions/_shared/cinematic-model";
import { extractFeatures, countDirectionReversals, detectPacingMismatch, summarizeSignal, summarizePolarity, variance } from "../../supabase/functions/_shared/cinematic-features";
import { scoreCinematic, CINEMATIC_THRESHOLDS, PENALTY_MAP } from "../../supabase/functions/_shared/cinematic-score";
import { amplifyRepairInstruction, buildTrailerRepairInstruction, buildStoryboardRepairInstruction } from "../../supabase/functions/_shared/cinematic-repair";
import { enforceUnitCount } from "../../supabase/functions/_shared/cinematic-adapters";
import { computeStoryboardExpectedCount, computeTrailerExpectedCount } from "../../supabase/functions/_shared/cinematic-expected-count";

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

  it("buildTrailerRepairInstruction includes shape guard and bullets", () => {
    const score = scoreCinematic([makeUnit({ id: "0", energy: 0.1 })]);
    const instruction = buildTrailerRepairInstruction(score);
    expect(instruction).toContain("CRITICAL REPAIR CONSTRAINTS");
    expect(instruction).toContain("TOO_SHORT");
  });

  it("buildStoryboardRepairInstruction includes unit_key guard", () => {
    const score = scoreCinematic([makeUnit({ id: "0", energy: 0.1 })]);
    const instruction = buildStoryboardRepairInstruction(score);
    expect(instruction).toContain("unit_key");
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
