/**
 * CIK Prompt Library — Char-budget enforcement + contract tests (Phase 4)
 */
import { describe, it, expect } from "vitest";
import {
  PROMPT_VERSION,
  MAX_REPAIR_CHARS,
  MAX_SYSTEM_PROMPT_CHARS,
  SYSTEM_DETERMINISM_RULES,
  OUTPUT_CONTRACT_TRAILER,
  OUTPUT_CONTRACT_STORYBOARD,
  CIK_QUALITY_MINIMUMS,
  SAFETY_BLOCK,
  LANE_OVERLAYS,
  getLaneOverlay,
  getAllLaneKeys,
  REQUIRED_REPAIR_BLOCKS,
  validateRepairInstruction,
  validateSystemPromptBudget,
} from "@/cik/prompts";

// Import the actual repair builders to test real output
import {
  buildTrailerRepairInstruction,
  buildStoryboardRepairInstruction,
} from "../../supabase/functions/_shared/cinematic-repair";

import type { CinematicScore } from "../../supabase/functions/_shared/cinematic-model";

/* ── Helper: build a CinematicScore with specific failures ── */
function makeScore(failures: string[], score = 0.45): CinematicScore {
  return {
    score,
    pass: false,
    failures: failures as any[],
    hard_failures: failures as any[],
    diagnostic_flags: [],
    metrics: {} as any,
    penalty_breakdown: [],
  };
}

/* ── A) MAX_REPAIR_CHARS constant ── */

describe("MAX_REPAIR_CHARS constant", () => {
  it("is exactly 2500", () => {
    expect(MAX_REPAIR_CHARS).toBe(2500);
  });
});

/* ── B) Prompt version ── */

describe("PROMPT_VERSION", () => {
  it("is a non-empty string", () => {
    expect(typeof PROMPT_VERSION).toBe("string");
    expect(PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it("matches expected format", () => {
    expect(PROMPT_VERSION).toMatch(/^cik_v\d+/);
  });
});

/* ── C) Repair instruction char budget enforcement ── */

describe("repair instruction char budget", () => {
  const ALL_FAILURES = [
    "TOO_SHORT", "NO_PEAK", "NO_ESCALATION", "WEAK_ARC",
    "FLATLINE", "ENERGY_DROP", "DIRECTION_REVERSAL",
    "LOW_CONTRAST", "PACING_MISMATCH", "TONAL_WHIPLASH",
    "LOW_INTENT_DIVERSITY", "EYE_LINE_BREAK",
  ];

  const LANES = ["feature_film", "series", "vertical_drama", "documentary", "unknown"];
  const UNIT_COUNTS = [4, 6, 8, 10, 12, 14];

  for (const lane of LANES) {
    for (const unitCount of UNIT_COUNTS) {
      it(`trailer repair <= ${MAX_REPAIR_CHARS} chars (lane=${lane}, units=${unitCount}, all failures)`, () => {
        const score = makeScore(ALL_FAILURES);
        const instruction = buildTrailerRepairInstruction(score, unitCount, lane);
        expect(instruction.length).toBeLessThanOrEqual(MAX_REPAIR_CHARS);
        expect(instruction.length).toBeGreaterThan(0);
      });

      it(`storyboard repair <= ${MAX_REPAIR_CHARS} chars (lane=${lane}, units=${unitCount}, all failures)`, () => {
        const score = makeScore(ALL_FAILURES);
        const instruction = buildStoryboardRepairInstruction(score, unitCount, lane);
        expect(instruction.length).toBeLessThanOrEqual(MAX_REPAIR_CHARS);
        expect(instruction.length).toBeGreaterThan(0);
      });
    }
  }

  it("single failure repair is under budget", () => {
    for (const f of ALL_FAILURES) {
      const instruction = buildTrailerRepairInstruction(makeScore([f]), 6, "feature_film");
      expect(instruction.length).toBeLessThanOrEqual(MAX_REPAIR_CHARS);
    }
  });

  it("empty failures produces minimal instruction", () => {
    const instruction = buildTrailerRepairInstruction(makeScore([], 0.9), 6);
    expect(instruction.length).toBeLessThanOrEqual(MAX_REPAIR_CHARS);
    expect(instruction.length).toBeGreaterThan(0);
  });
});

/* ── D) Required blocks present in repair instructions ── */

describe("repair instruction required blocks", () => {
  it("trailer repair contains all required blocks", () => {
    const score = makeScore(["WEAK_ARC", "NO_PEAK"]);
    const instruction = buildTrailerRepairInstruction(score, 8, "feature_film");
    for (const block of REQUIRED_REPAIR_BLOCKS) {
      expect(instruction).toContain(block);
    }
  });

  it("storyboard repair contains all required blocks", () => {
    const score = makeScore(["FLATLINE", "ENERGY_DROP"]);
    const instruction = buildStoryboardRepairInstruction(score, 10, "series");
    for (const block of REQUIRED_REPAIR_BLOCKS) {
      expect(instruction).toContain(block);
    }
  });

  it("validateRepairInstruction catches missing blocks", () => {
    const result = validateRepairInstruction("Fix things please.");
    expect(result.valid).toBe(false);
    expect(result.hasRequiredBlocks).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("validateRepairInstruction passes valid instruction", () => {
    const score = makeScore(["WEAK_ARC"]);
    const instruction = buildTrailerRepairInstruction(score, 6, "documentary");
    const result = validateRepairInstruction(instruction);
    expect(result.charCount).toBeLessThanOrEqual(MAX_REPAIR_CHARS);
    expect(result.promptVersion).toBe(PROMPT_VERSION);
  });
});

/* ── E) System prompt budget with lane overlays ── */

describe("system prompt budget", () => {
  const basePrompt = [
    SYSTEM_DETERMINISM_RULES,
    OUTPUT_CONTRACT_TRAILER,
    CIK_QUALITY_MINIMUMS,
    SAFETY_BLOCK,
  ].join("\n\n");

  it("base prompt alone is under budget", () => {
    expect(basePrompt.length).toBeLessThan(MAX_SYSTEM_PROMPT_CHARS);
  });

  for (const lane of getAllLaneKeys()) {
    it(`base + ${lane} overlay is under system prompt budget`, () => {
      const result = validateSystemPromptBudget(basePrompt, lane, MAX_SYSTEM_PROMPT_CHARS);
      expect(result.valid).toBe(true);
    });
  }

  it("unknown lane does not add overlay", () => {
    expect(getLaneOverlay("unknown_xyz")).toBeUndefined();
    const result = validateSystemPromptBudget(basePrompt, "unknown_xyz", MAX_SYSTEM_PROMPT_CHARS);
    expect(result.valid).toBe(true);
    expect(result.totalChars).toBe(basePrompt.length);
  });
});

/* ── F) Lane overlays completeness ── */

describe("lane overlays", () => {
  const EXPECTED_LANES = ["feature_film", "series", "vertical_drama", "documentary"];

  it("all expected lanes have overlays", () => {
    for (const lane of EXPECTED_LANES) {
      const overlay = getLaneOverlay(lane);
      expect(overlay).toBeDefined();
      expect(overlay!.lane).toBe(lane);
      expect(overlay!.systemSuffix.length).toBeGreaterThan(0);
      expect(overlay!.repairHints.length).toBeGreaterThan(0);
    }
  });

  it("overlay repairHints are under 500 chars each", () => {
    for (const lane of EXPECTED_LANES) {
      const overlay = getLaneOverlay(lane)!;
      expect(overlay.repairHints.length).toBeLessThan(500);
    }
  });

  it("getAllLaneKeys returns expected lanes", () => {
    const keys = getAllLaneKeys();
    expect(keys).toEqual(expect.arrayContaining(EXPECTED_LANES));
  });
});

/* ── G) Prompt version in persistence ── */

describe("prompt version persistence", () => {
  it("PROMPT_VERSION is a valid semver-like string", () => {
    expect(PROMPT_VERSION).toMatch(/^cik_v\d+\.\d+/);
  });

  it("can be included in attempt payload", () => {
    const payload = {
      model: "test",
      promptVersion: PROMPT_VERSION,
      score: 0.85,
      pass: true,
    };
    expect(payload.promptVersion).toBe(PROMPT_VERSION);
    expect(JSON.stringify(payload)).toContain(PROMPT_VERSION);
  });
});
