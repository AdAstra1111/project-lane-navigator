/**
 * Video Render Jobs — Tests
 * Deterministic prompt_json generation, type correctness, edge cases.
 */
import { describe, it, expect } from "vitest";
import { buildShotPrompt, type RenderShotPrompt } from "@/videoPlans/renderTypes";

/* ── Helper ── */

function makeShot(overrides: Partial<Parameters<typeof buildShotPrompt>[0]> = {}) {
  return {
    shotIndex: 0,
    unitIndex: 0,
    shotType: "WIDE",
    cameraMove: "STATIC",
    lensMm: 24,
    durationSec: 5,
    description: "Establishing shot of cityscape",
    continuityTags: ["screenDirection:L", "energyBand:low"],
    ...overrides,
  };
}

/* ── A) Determinism ── */

describe("buildShotPrompt — determinism", () => {
  it("same input produces identical output", () => {
    const shot = makeShot();
    const p1 = buildShotPrompt(shot);
    const p2 = buildShotPrompt(shot);
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
  });

  it("different inputs produce different prompts", () => {
    const p1 = buildShotPrompt(makeShot({ shotType: "WIDE" }));
    const p2 = buildShotPrompt(makeShot({ shotType: "CLOSE" }));
    expect(p1.textPrompt).not.toBe(p2.textPrompt);
  });
});

/* ── B) Prompt structure ── */

describe("buildShotPrompt — structure", () => {
  it("contains all required fields", () => {
    const p = buildShotPrompt(makeShot());
    expect(typeof p.shotIndex).toBe("number");
    expect(typeof p.unitIndex).toBe("number");
    expect(typeof p.shotType).toBe("string");
    expect(typeof p.cameraMove).toBe("string");
    expect(typeof p.lensMm).toBe("number");
    expect(typeof p.durationSec).toBe("number");
    expect(typeof p.description).toBe("string");
    expect(Array.isArray(p.continuityTags)).toBe(true);
    expect(typeof p.textPrompt).toBe("string");
  });

  it("textPrompt includes shot type and camera move", () => {
    const p = buildShotPrompt(makeShot({ shotType: "CLOSE", cameraMove: "HANDHELD" }));
    expect(p.textPrompt).toContain("CLOSE shot");
    expect(p.textPrompt).toContain("HANDHELD movement");
  });

  it("textPrompt includes lens and duration", () => {
    const p = buildShotPrompt(makeShot({ lensMm: 85, durationSec: 2.5 }));
    expect(p.textPrompt).toContain("85mm lens");
    expect(p.textPrompt).toContain("2.5s duration");
  });

  it("textPrompt includes description", () => {
    const p = buildShotPrompt(makeShot({ description: "Hero enters the room" }));
    expect(p.textPrompt).toContain("Hero enters the room");
  });
});

/* ── C) Continuity tags ── */

describe("buildShotPrompt — continuity tags", () => {
  it("copies continuityTags without mutation", () => {
    const tags = ["screenDirection:L", "energyBand:high"];
    const p = buildShotPrompt(makeShot({ continuityTags: tags }));
    expect(p.continuityTags).toEqual(tags);
    // Ensure it's a copy, not same reference
    expect(p.continuityTags).not.toBe(tags);
  });

  it("handles empty continuityTags", () => {
    const p = buildShotPrompt(makeShot({ continuityTags: [] }));
    expect(p.continuityTags).toEqual([]);
  });
});

/* ── D) Edge cases ── */

describe("buildShotPrompt — edge cases", () => {
  it("handles zero duration", () => {
    const p = buildShotPrompt(makeShot({ durationSec: 0 }));
    expect(p.durationSec).toBe(0);
    expect(p.textPrompt).toContain("0s duration");
  });

  it("handles high shot index", () => {
    const p = buildShotPrompt(makeShot({ shotIndex: 999 }));
    expect(p.shotIndex).toBe(999);
    expect(p.textPrompt).toContain("Shot 999:");
  });
});

/* ── E) Batch determinism — multiple shots ── */

describe("buildShotPrompt — batch", () => {
  it("generates unique prompts for each shot in a sequence", () => {
    const prompts = [0, 1, 2, 3].map((i) =>
      buildShotPrompt(makeShot({ shotIndex: i, unitIndex: Math.floor(i / 2) }))
    );
    const textPrompts = prompts.map((p) => p.textPrompt);
    const uniqueSet = new Set(textPrompts);
    expect(uniqueSet.size).toBe(4);
  });
});
