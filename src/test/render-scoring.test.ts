/**
 * Render Scoring Rubric — Tests
 * Determinism, pass/fail, failure codes, payload correctness.
 */
import { describe, it, expect } from "vitest";
import {
  computeRenderScore,
  computePass,
  deriveHardFailures,
  deriveDiagnosticFlags,
  buildRenderQualityPayload,
  type RenderJobSummary,
} from "@/videoRender/renderScoring";

function makeSummary(overrides: Partial<RenderJobSummary> = {}): RenderJobSummary {
  return {
    projectId: "p1",
    jobId: "j1",
    planId: "pl1",
    lane: "feature_film",
    providerId: "veo",
    modelId: "veo-2",
    totalShots: 10,
    completedShots: 10,
    failedShots: 0,
    totalRetries: 0,
    avgCostPerShot: 0.5,
    continuityWarnings: [],
    roughCutStatus: "complete",
    processingTimeMs: 5000,
    shotArtifacts: [],
    ...overrides,
  };
}

/* ── Score determinism ── */

describe("computeRenderScore — determinism", () => {
  it("same inputs produce identical score", () => {
    const s = makeSummary();
    expect(computeRenderScore(s)).toBe(computeRenderScore(s));
  });

  it("perfect job scores 1.0", () => {
    const s = makeSummary();
    expect(computeRenderScore(s)).toBe(1.0);
  });

  it("all failed scores near 0", () => {
    const s = makeSummary({ completedShots: 0, failedShots: 10, roughCutStatus: "error" });
    expect(computeRenderScore(s)).toBeLessThan(0.5);
  });

  it("zero shots returns 0", () => {
    expect(computeRenderScore(makeSummary({ totalShots: 0 }))).toBe(0);
  });

  it("partial completion reduces score", () => {
    const full = computeRenderScore(makeSummary());
    const partial = computeRenderScore(makeSummary({ completedShots: 5 }));
    expect(partial).toBeLessThan(full);
  });

  it("high retries reduce score", () => {
    const low = computeRenderScore(makeSummary({ totalRetries: 0 }));
    const high = computeRenderScore(makeSummary({ totalRetries: 10 }));
    expect(high).toBeLessThan(low);
  });
});

/* ── Pass/fail ── */

describe("computePass", () => {
  it("passes when all shots complete and no failures", () => {
    expect(computePass(makeSummary())).toBe(true);
  });

  it("fails when shots failed", () => {
    expect(computePass(makeSummary({ failedShots: 1 }))).toBe(false);
  });

  it("fails when not all shots complete", () => {
    expect(computePass(makeSummary({ completedShots: 9 }))).toBe(false);
  });

  it("fails with many continuity warnings", () => {
    expect(computePass(makeSummary({ continuityWarnings: ["a", "b", "c", "d", "e"] }))).toBe(false);
  });
});

/* ── Hard failure codes ── */

describe("deriveHardFailures — render namespace", () => {
  it("RENDER_SHOT_FAILED when failedShots > 0", () => {
    expect(deriveHardFailures(makeSummary({ failedShots: 1 }))).toContain("RENDER_SHOT_FAILED");
  });

  it("RENDER_CONTINUITY_VIOLATION at threshold", () => {
    const warnings = ["a", "b", "c", "d", "e"];
    expect(deriveHardFailures(makeSummary({ continuityWarnings: warnings }))).toContain("RENDER_CONTINUITY_VIOLATION");
  });

  it("RENDER_ASSEMBLY_FAILED on rough cut error", () => {
    expect(deriveHardFailures(makeSummary({ roughCutStatus: "error" }))).toContain("RENDER_ASSEMBLY_FAILED");
  });

  it("RENDER_TOTAL_FAILURE when zero completed", () => {
    expect(deriveHardFailures(makeSummary({ completedShots: 0, failedShots: 10 }))).toContain("RENDER_TOTAL_FAILURE");
  });

  it("no CIK failure codes ever used", () => {
    const cikCodes = ["FLATLINE", "WEAK_ARC", "PACING_MISMATCH", "INTENT_MONOCULTURE", "MISSING_UNIT"];
    const all = deriveHardFailures(makeSummary({ failedShots: 5, continuityWarnings: Array(10).fill("w"), roughCutStatus: "error", completedShots: 0 }));
    for (const code of cikCodes) {
      expect(all).not.toContain(code);
    }
  });

  it("all codes use RENDER_ prefix", () => {
    const all = deriveHardFailures(makeSummary({ failedShots: 5, continuityWarnings: Array(10).fill("w"), roughCutStatus: "error", completedShots: 0 }));
    for (const code of all) {
      expect(code.startsWith("RENDER_")).toBe(true);
    }
  });
});

/* ── Diagnostic flags ── */

describe("deriveDiagnosticFlags", () => {
  it("RENDER_HIGH_RETRY_RATE when retries >= 50%", () => {
    expect(deriveDiagnosticFlags(makeSummary({ totalRetries: 5 }))).toContain("RENDER_HIGH_RETRY_RATE");
  });

  it("RENDER_CONTINUITY_WARNINGS below threshold", () => {
    expect(deriveDiagnosticFlags(makeSummary({ continuityWarnings: ["a", "b"] }))).toContain("RENDER_CONTINUITY_WARNINGS");
  });

  it("RENDER_NO_ROUGH_CUT when none", () => {
    expect(deriveDiagnosticFlags(makeSummary({ roughCutStatus: "none" }))).toContain("RENDER_NO_ROUGH_CUT");
  });
});

/* ── Payload correctness ── */

describe("buildRenderQualityPayload", () => {
  it("run_source is video_render", () => {
    const p = buildRenderQualityPayload(makeSummary());
    expect(p.run.run_source).toBe("video_render");
  });

  it("engine is video_render", () => {
    const p = buildRenderQualityPayload(makeSummary());
    expect(p.run.engine).toBe("video_render");
  });

  it("attempt_count is 1", () => {
    const p = buildRenderQualityPayload(makeSummary());
    expect(p.run.attempt_count).toBe(1);
  });

  it("attempt0 index is 0", () => {
    const p = buildRenderQualityPayload(makeSummary());
    expect(p.attempt0.attempt_index).toBe(0);
  });

  it("metrics_json includes expected fields", () => {
    const p = buildRenderQualityPayload(makeSummary());
    const m = p.run.metrics_json as any;
    expect(m.totalShots).toBe(10);
    expect(m.provider_id).toBe("veo");
    expect(m.model_id).toBe("veo-2");
    expect(m.roughCutStatus).toBe("complete");
  });

  it("payload is deterministic", () => {
    const s = makeSummary();
    const p1 = JSON.stringify(buildRenderQualityPayload(s));
    const p2 = JSON.stringify(buildRenderQualityPayload(s));
    expect(p1).toBe(p2);
  });

  it("scoring rubric fixtures — perfect job", () => {
    const p = buildRenderQualityPayload(makeSummary());
    expect(p.run.final_pass).toBe(true);
    expect(p.run.final_score).toBe(1.0);
    expect(p.run.hard_failures).toEqual([]);
  });

  it("scoring rubric fixtures — partial failure", () => {
    const p = buildRenderQualityPayload(makeSummary({ completedShots: 7, failedShots: 3 }));
    expect(p.run.final_pass).toBe(false);
    expect(p.run.final_score).toBeGreaterThan(0.3);
    expect(p.run.final_score).toBeLessThan(0.9);
    expect(p.run.hard_failures).toContain("RENDER_SHOT_FAILED");
  });

  it("scoring rubric fixtures — total failure", () => {
    const p = buildRenderQualityPayload(makeSummary({ completedShots: 0, failedShots: 10, roughCutStatus: "error" }));
    expect(p.run.final_pass).toBe(false);
    expect(p.run.final_score).toBeLessThan(0.5);
    expect(p.run.hard_failures).toContain("RENDER_TOTAL_FAILURE");
    expect(p.run.hard_failures).toContain("RENDER_SHOT_FAILED");
    expect(p.run.hard_failures).toContain("RENDER_ASSEMBLY_FAILED");
  });
});
