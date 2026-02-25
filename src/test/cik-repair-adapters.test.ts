/**
 * CIK — Repair Instructions + Adapters + Diagnostics Tests
 * Split from cinematic-features.test.ts (lines 239–512). No logic changes.
 */
import { describe, it, expect } from "vitest";

import type { CinematicUnit, CinematicFailureCode, CinematicScore } from "../../supabase/functions/_shared/cinematic-model";
import { DIAGNOSTIC_ONLY_CODES } from "../../supabase/functions/_shared/cinematic-model";
import { scoreCinematic } from "../../supabase/functions/_shared/cinematic-score";
import { amplifyRepairInstruction, buildTrailerRepairInstruction, buildStoryboardRepairInstruction, numericTargetsForFailures } from "../../supabase/functions/_shared/cinematic-repair";
import { enforceUnitCount } from "../../supabase/functions/_shared/cinematic-adapters";
import { computeStoryboardExpectedCount, computeTrailerExpectedCount } from "../../supabase/functions/_shared/cinematic-expected-count";
import { makeUnit } from "./helpers/cinematic-test-utils";

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
    expect(escalationTargets).toHaveLength(1);
  });

  it("returns empty for unknown failures", () => {
    const { targets, covered } = numericTargetsForFailures({ failures: ["UNKNOWN_CODE" as any], unitCount: 6 });
    expect(targets).toHaveLength(0);
    expect(covered.size).toBe(0);
  });

  it("computes latePeakMin correctly for small unit counts", () => {
    const { targets } = numericTargetsForFailures({ failures: ["ENERGY_DROP"], unitCount: 4 });
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
    const instr = buildTrailerRepairInstruction(makeScore(["NO_PEAK"]), 8);
    expect(instr).toContain("CONTEXT-AWARE NUMERIC TARGETS");
    expect(instr).toContain("peakIndex must be >= 6");
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
    const { enforceCinematicQuality } = await import("../../supabase/functions/_shared/cinematic-kernel");
    
    let receivedCount: number | undefined;
    const mockAdapter = (raw: any, expectedCount?: number) => {
      receivedCount = expectedCount;
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
      // May fail quality gate, that's fine
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
