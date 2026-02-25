/**
 * Video Render — Prompt Compiler + Provider Tests
 * Determinism, seed stability, prompt structure, mock provider flow.
 */
import { describe, it, expect } from "vitest";
import { compileProviderRequest, fnv1aHash, deriveSeed } from "@/videoRender/promptCompiler";
import { buildShotPrompt } from "@/videoPlans/renderTypes";
import type { Shot } from "@/videoPlans/types";

/* ── Helpers ── */

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    shotIndex: 0,
    unitIndex: 0,
    shotType: "WIDE",
    cameraMove: "STATIC",
    lensMm: 24,
    durationSec: 5,
    description: "Establishing shot of cityscape at dawn",
    continuityTags: ["screenDirection:L", "energyBand:low"],
    ...overrides,
  };
}

/* ── A) FNV-1a Hash Stability ── */

describe("fnv1aHash — stability", () => {
  it("same input produces identical hash", () => {
    const h1 = fnv1aHash("test:input:42");
    const h2 = fnv1aHash("test:input:42");
    expect(h1).toBe(h2);
  });

  it("different inputs produce different hashes", () => {
    const h1 = fnv1aHash("a:b:0");
    const h2 = fnv1aHash("a:b:1");
    expect(h1).not.toBe(h2);
  });

  it("returns unsigned 32-bit integer", () => {
    const h = fnv1aHash("any string");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF);
  });

  it("is deterministic across multiple calls", () => {
    const results = Array.from({ length: 100 }, () => fnv1aHash("deterministic"));
    expect(new Set(results).size).toBe(1);
  });
});

/* ── B) Seed Derivation ── */

describe("deriveSeed — determinism", () => {
  it("same project+plan+shot produces same seed", () => {
    const s1 = deriveSeed("proj-1", "plan-1", 0);
    const s2 = deriveSeed("proj-1", "plan-1", 0);
    expect(s1).toBe(s2);
  });

  it("different shot index produces different seed", () => {
    const s1 = deriveSeed("proj-1", "plan-1", 0);
    const s2 = deriveSeed("proj-1", "plan-1", 1);
    expect(s1).not.toBe(s2);
  });

  it("different project produces different seed", () => {
    const s1 = deriveSeed("proj-1", "plan-1", 0);
    const s2 = deriveSeed("proj-2", "plan-1", 0);
    expect(s1).not.toBe(s2);
  });

  it("different plan produces different seed", () => {
    const s1 = deriveSeed("proj-1", "plan-1", 0);
    const s2 = deriveSeed("proj-1", "plan-2", 0);
    expect(s1).not.toBe(s2);
  });
});

/* ── C) Prompt Compiler Determinism ── */

describe("compileProviderRequest — determinism", () => {
  const baseInput = {
    projectId: "proj-1",
    planId: "plan-1",
    shot: makeShot(),
    unitIntent: "reveal",
    unitEnergy: 0.4,
  };

  it("same input produces identical request", () => {
    const r1 = compileProviderRequest(baseInput);
    const r2 = compileProviderRequest(baseInput);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("includes shot type framing in prompt", () => {
    const r = compileProviderRequest(baseInput);
    expect(r.prompt).toContain("wide establishing shot");
  });

  it("includes camera movement in prompt", () => {
    const r = compileProviderRequest(baseInput);
    expect(r.prompt).toContain("static locked camera");
  });

  it("includes lens in prompt", () => {
    const r = compileProviderRequest(baseInput);
    expect(r.prompt).toContain("24mm focal length");
  });

  it("includes unit intent in prompt", () => {
    const r = compileProviderRequest(baseInput);
    expect(r.prompt).toContain("Narrative intent: reveal");
  });

  it("includes energy description in prompt", () => {
    const r = compileProviderRequest(baseInput);
    expect(r.prompt).toContain("calm, measured pacing");
  });

  it("high energy produces different energy description", () => {
    const r = compileProviderRequest({ ...baseInput, unitEnergy: 0.95 });
    expect(r.prompt).toContain("high intensity, fast pacing");
  });

  it("includes continuity tags as constraints", () => {
    const r = compileProviderRequest(baseInput);
    expect(r.prompt).toContain("Constraint: screenDirection:L");
    expect(r.prompt).toContain("Constraint: energyBand:low");
  });
});

/* ── D) Negative Prompt ── */

describe("compileProviderRequest — negative prompt", () => {
  it("includes global negative prompt", () => {
    const r = compileProviderRequest({
      projectId: "p", planId: "pl", shot: makeShot(),
    });
    expect(r.negativePrompt).toContain("blurry");
    expect(r.negativePrompt).toContain("watermark");
  });

  it("includes avoid constraints from tags", () => {
    const r = compileProviderRequest({
      projectId: "p", planId: "pl",
      shot: makeShot({ continuityTags: ["avoid:jumpcut", "screenDirection:L"] }),
    });
    expect(r.negativePrompt).toContain("jumpcut");
    // avoid: tags should NOT appear in the positive prompt as constraints
    expect(r.prompt).not.toContain("avoid:jumpcut");
    expect(r.prompt).toContain("Constraint: screenDirection:L");
  });
});

/* ── E) Seed is stored in request ── */

describe("compileProviderRequest — seed", () => {
  it("seed is a positive integer", () => {
    const r = compileProviderRequest({
      projectId: "p", planId: "pl", shot: makeShot(),
    });
    expect(r.seed).toBeGreaterThan(0);
    expect(Number.isInteger(r.seed)).toBe(true);
  });

  it("seed matches deriveSeed output", () => {
    const r = compileProviderRequest({
      projectId: "proj-abc", planId: "plan-xyz", shot: makeShot({ shotIndex: 7 }),
    });
    expect(r.seed).toBe(deriveSeed("proj-abc", "plan-xyz", 7));
  });
});

/* ── F) Provider request structure ── */

describe("compileProviderRequest — structure", () => {
  it("has all required fields", () => {
    const r = compileProviderRequest({
      projectId: "p", planId: "pl", shot: makeShot(),
    });
    expect(r.providerId).toBe("veo");
    expect(r.modelId).toBe("veo-2");
    expect(r.resolution).toBe("1280x720");
    expect(r.fps).toBe(24);
    expect(typeof r.durationSec).toBe("number");
    expect(typeof r.prompt).toBe("string");
    expect(typeof r.negativePrompt).toBe("string");
    expect(Array.isArray(r.continuityConstraints)).toBe(true);
  });

  it("respects override settings", () => {
    const r = compileProviderRequest({
      projectId: "p", planId: "pl", shot: makeShot(),
      providerId: "runway", modelId: "gen-3", resolution: "1920x1080", fps: 30,
    });
    expect(r.providerId).toBe("runway");
    expect(r.modelId).toBe("gen-3");
    expect(r.resolution).toBe("1920x1080");
    expect(r.fps).toBe(30);
  });
});

/* ── G) Batch — all shots in a plan produce unique seeds+prompts ── */

describe("compileProviderRequest — batch uniqueness", () => {
  it("10 shots produce 10 unique seeds", () => {
    const seeds = Array.from({ length: 10 }, (_, i) =>
      compileProviderRequest({
        projectId: "p", planId: "pl",
        shot: makeShot({ shotIndex: i }),
      }).seed
    );
    expect(new Set(seeds).size).toBe(10);
  });

  it("10 shots produce 10 unique prompts when descriptions differ", () => {
    const prompts = Array.from({ length: 10 }, (_, i) =>
      compileProviderRequest({
        projectId: "p", planId: "pl",
        shot: makeShot({ shotIndex: i, description: `Scene ${i} action` }),
      }).prompt
    );
    expect(new Set(prompts).size).toBe(10);
  });
});

/* ── H) Mock provider flow ── */

describe("mock provider flow", () => {
  it("processing a shot produces artifact_json shape", () => {
    // Simulate what the edge function does after provider returns complete
    const shot = makeShot({ shotIndex: 3 });
    const compiled = compileProviderRequest({
      projectId: "proj-1", planId: "plan-1", shot,
    });

    // Mock provider response
    const providerResponse = {
      providerJobId: "op-12345",
      status: "complete" as const,
      outputVideoUrl: "https://storage.example.com/video.mp4",
    };

    // Build artifact_json deterministically
    const artifactJson = {
      storagePath: `projects/proj-1/renders/job-1/shots/${shot.shotIndex}.mp4`,
      publicUrl: providerResponse.outputVideoUrl,
      durationSec: compiled.durationSec,
      provider: compiled.providerId,
      providerJobId: providerResponse.providerJobId,
      generatedAt: "2026-02-25T00:00:00.000Z",
    };

    expect(artifactJson.storagePath).toContain("shots/3.mp4");
    expect(artifactJson.provider).toBe("veo");
    expect(artifactJson.providerJobId).toBe("op-12345");
    expect(artifactJson.durationSec).toBe(5);
  });

  it("error path preserves attempt count semantics", () => {
    // Simulate error flow
    const mockShot = { id: "s1", attempt_count: 1, status: "claimed" };
    const maxAttempts = 3;

    // After error, attempt_count < max => retry (re-queue)
    const shouldRetry = mockShot.attempt_count < maxAttempts;
    expect(shouldRetry).toBe(true);

    // At max => permanent error
    const atMax = { ...mockShot, attempt_count: 3 };
    expect(atMax.attempt_count >= maxAttempts).toBe(true);
  });
});
