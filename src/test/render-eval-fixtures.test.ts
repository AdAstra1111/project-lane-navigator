/**
 * Render Eval Fixtures — Regression tests for planner, prompt compiler, and scoring.
 * No network calls. Purely deterministic.
 */
import { describe, it, expect } from "vitest";
import { compileProviderRequest, deriveSeed } from "@/videoRender/promptCompiler";
import { compilePromptDelta, applyDelta } from "@/videoRender/noteDeltas";
import { computeRenderScore, buildRenderQualityPayload, type RenderJobSummary } from "@/videoRender/renderScoring";
import type { Shot } from "@/videoPlans/types";

/* ── Prompt compiler determinism fixtures ── */

const FIXTURE_SHOT: Shot = {
  shotIndex: 0,
  unitIndex: 0,
  shotType: "WIDE",
  cameraMove: "DOLLY",
  lensMm: 35,
  durationSec: 4,
  description: "Hero enters the frame from left",
  continuityTags: ["screenDirection:L", "avoid:jumpcut"],
};

describe("Prompt compiler — determinism fixtures", () => {
  it("same plan+shot => identical prompt + seed", () => {
    const r1 = compileProviderRequest({ projectId: "p1", planId: "pl1", shot: FIXTURE_SHOT });
    const r2 = compileProviderRequest({ projectId: "p1", planId: "pl1", shot: FIXTURE_SHOT });
    expect(r1.prompt).toBe(r2.prompt);
    expect(r1.seed).toBe(r2.seed);
    expect(r1.negativePrompt).toBe(r2.negativePrompt);
    expect(r1.durationSec).toBe(r2.durationSec);
  });

  it("different shotIndex => different seed", () => {
    const s2 = { ...FIXTURE_SHOT, shotIndex: 1 };
    const r1 = compileProviderRequest({ projectId: "p1", planId: "pl1", shot: FIXTURE_SHOT });
    const r2 = compileProviderRequest({ projectId: "p1", planId: "pl1", shot: s2 });
    expect(r1.seed).not.toBe(r2.seed);
  });

  it("continuity tags appear in prompt", () => {
    const r = compileProviderRequest({ projectId: "p1", planId: "pl1", shot: FIXTURE_SHOT });
    expect(r.prompt).toContain("screenDirection:L");
  });

  it("avoid tags appear in negative prompt", () => {
    const r = compileProviderRequest({ projectId: "p1", planId: "pl1", shot: FIXTURE_SHOT });
    expect(r.negativePrompt).toContain("jumpcut");
  });

  it("seed is stable across repeated derivation", () => {
    const s1 = deriveSeed("p1", "pl1", 0);
    const s2 = deriveSeed("p1", "pl1", 0);
    expect(s1).toBe(s2);
  });
});

/* ── Prompt + notes fixture ── */

describe("Prompt compiler + notes — combined fixtures", () => {
  it("notes 'brighter' adds lighting constraint to compiled prompt delta", () => {
    const delta = compilePromptDelta({ notes: "brighter" });
    expect(delta.addConstraints).toContain("lighting:high_key");
    // Apply delta to shot
    const result = applyDelta(4, "DOLLY", ["screenDirection:L"], delta);
    expect(result.continuityTags).toContain("lighting:high_key");
    expect(result.continuityTags).toContain("screenDirection:L");
  });

  it("notes 'slower' increases duration deterministically", () => {
    const delta = compilePromptDelta({ notes: "slower" });
    const result = applyDelta(4, "STATIC", [], delta);
    expect(result.durationSec).toBeCloseTo(4.4);
  });
});

/* ── Scoring rubric fixtures ── */

function makeSummary(overrides: Partial<RenderJobSummary> = {}): RenderJobSummary {
  return {
    projectId: "p1", jobId: "j1", planId: "pl1", lane: "feature_film",
    providerId: "veo", modelId: "veo-2",
    totalShots: 10, completedShots: 10, failedShots: 0, totalRetries: 0,
    avgCostPerShot: 0.5, continuityWarnings: [], roughCutStatus: "complete",
    processingTimeMs: 5000, shotArtifacts: [],
    ...overrides,
  };
}

describe("Scoring rubric — regression fixtures", () => {
  const cases: Array<{
    name: string;
    summary: RenderJobSummary;
    expectPass: boolean;
    scoreMin: number;
    scoreMax: number;
    expectCodes: string[];
  }> = [
    {
      name: "perfect render",
      summary: makeSummary(),
      expectPass: true,
      scoreMin: 0.99,
      scoreMax: 1.0,
      expectCodes: [],
    },
    {
      name: "3 failed shots",
      summary: makeSummary({ completedShots: 7, failedShots: 3 }),
      expectPass: false,
      scoreMin: 0.5,
      scoreMax: 0.85,
      expectCodes: ["RENDER_SHOT_FAILED"],
    },
    {
      name: "total failure",
      summary: makeSummary({ completedShots: 0, failedShots: 10, roughCutStatus: "error" }),
      expectPass: false,
      scoreMin: 0,
      scoreMax: 0.5,
      expectCodes: ["RENDER_TOTAL_FAILURE", "RENDER_SHOT_FAILED", "RENDER_ASSEMBLY_FAILED"],
    },
    {
      name: "continuity violation",
      summary: makeSummary({ continuityWarnings: ["a", "b", "c", "d", "e", "f"] }),
      expectPass: false,
      scoreMin: 0.6,
      scoreMax: 0.95,
      expectCodes: ["RENDER_CONTINUITY_VIOLATION"],
    },
  ];

  for (const tc of cases) {
    it(`${tc.name}: pass=${tc.expectPass}, score in [${tc.scoreMin},${tc.scoreMax}]`, () => {
      const p = buildRenderQualityPayload(tc.summary);
      expect(p.run.final_pass).toBe(tc.expectPass);
      expect(p.run.final_score).toBeGreaterThanOrEqual(tc.scoreMin);
      expect(p.run.final_score).toBeLessThanOrEqual(tc.scoreMax);
      for (const code of tc.expectCodes) {
        expect(p.run.hard_failures).toContain(code);
      }
    });
  }

  it("all fixture scores are deterministic across runs", () => {
    for (const tc of cases) {
      const s1 = computeRenderScore(tc.summary);
      const s2 = computeRenderScore(tc.summary);
      expect(s1).toBe(s2);
    }
  });
});
