/**
 * Note Deltas + Shot Locking — Tests
 * Determinism, clamping, conflicts, unknown notes, applyDelta.
 */
import { describe, it, expect } from "vitest";
import { compilePromptDelta, applyDelta, type PromptDelta } from "@/videoRender/noteDeltas";

/* ── compilePromptDelta determinism ── */

describe("compilePromptDelta — determinism", () => {
  it("same notes produce identical output", () => {
    const d1 = compilePromptDelta({ notes: "brighter, slower" });
    const d2 = compilePromptDelta({ notes: "brighter, slower" });
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });

  it("empty notes produce no deltas", () => {
    const d = compilePromptDelta({ notes: "" });
    expect(d.addConstraints).toEqual([]);
    expect(d.durationMultiplier).toBe(1.0);
    expect(d.warnings).toEqual([]);
  });

  it("null-ish notes produce no deltas", () => {
    const d = compilePromptDelta({ notes: "   " });
    expect(d.addConstraints).toEqual([]);
  });
});

/* ── Keyword mapping ── */

describe("compilePromptDelta — keywords", () => {
  it("brighter adds high_key lighting", () => {
    const d = compilePromptDelta({ notes: "make it brighter" });
    expect(d.addConstraints).toContain("lighting:high_key");
  });

  it("darker adds low_key lighting", () => {
    const d = compilePromptDelta({ notes: "darker mood" });
    expect(d.addConstraints).toContain("lighting:low_key");
  });

  it("slower increases duration by 10%", () => {
    const d = compilePromptDelta({ notes: "slower" });
    expect(d.durationMultiplier).toBeCloseTo(1.1);
  });

  it("faster decreases duration by 10%", () => {
    const d = compilePromptDelta({ notes: "faster" });
    expect(d.durationMultiplier).toBeCloseTo(0.9);
  });

  it("more handheld sets camera override", () => {
    const d = compilePromptDelta({ notes: "more handheld feel" });
    expect(d.cameraMoveOverride).toBe("HANDHELD");
  });

  it("no shake adds negative prompt", () => {
    const d = compilePromptDelta({ notes: "no shake please" });
    expect(d.addNegative).toContain("camera shake");
  });
});

/* ── Clamping ── */

describe("compilePromptDelta — clamping", () => {
  it("multiple 'slower' clamps at 1.5x", () => {
    // "slower" appears once -> 1.1, "much slower" -> 1.1*1.25 = 1.375
    const d = compilePromptDelta({ notes: "slower much slower" });
    expect(d.durationMultiplier).toBeLessThanOrEqual(1.5);
    expect(d.durationMultiplier).toBeGreaterThan(1.0);
  });

  it("multiple 'faster' clamps at 0.5x", () => {
    const d = compilePromptDelta({ notes: "faster much faster" });
    expect(d.durationMultiplier).toBeGreaterThanOrEqual(0.5);
    expect(d.durationMultiplier).toBeLessThan(1.0);
  });
});

/* ── Unknown notes ── */

describe("compilePromptDelta — unknown notes", () => {
  it("unknown text does not generate deltas", () => {
    const d = compilePromptDelta({ notes: "add a purple elephant dancing" });
    expect(d.addConstraints).toEqual([]);
    expect(d.cameraMoveOverride).toBeUndefined();
    expect(d.durationMultiplier).toBe(1.0);
    expect(d.addNegative).toEqual([]);
  });

  it("preserves raw notes for audit", () => {
    const d = compilePromptDelta({ notes: "random text xyz" });
    expect(d.rawNotes).toBe("random text xyz");
  });
});

/* ── Conflicts ── */

describe("compilePromptDelta — conflicts", () => {
  it("brighter + darker produces warning and keeps darker", () => {
    const d = compilePromptDelta({ notes: "brighter and darker" });
    expect(d.warnings.length).toBeGreaterThan(0);
    expect(d.warnings[0]).toContain("Contradictory lighting");
    expect(d.addConstraints).toContain("lighting:low_key");
    expect(d.addConstraints).not.toContain("lighting:high_key");
  });

  it("handheld + low energy produces warning", () => {
    const d = compilePromptDelta({
      notes: "more handheld",
      cameraMove: "STATIC",
      energyBand: "low",
    });
    expect(d.cameraMoveOverride).toBe("HANDHELD");
    expect(d.warnings.length).toBeGreaterThan(0);
  });
});

/* ── applyDelta ── */

describe("applyDelta", () => {
  it("applies duration multiplier", () => {
    const delta: PromptDelta = {
      addConstraints: [], removeConstraints: [], durationMultiplier: 1.1,
      addNegative: [], warnings: [], rawNotes: "slower",
    };
    const result = applyDelta(5.0, "STATIC", [], delta);
    expect(result.durationSec).toBeCloseTo(5.5);
  });

  it("applies camera move override", () => {
    const delta: PromptDelta = {
      addConstraints: [], removeConstraints: [], durationMultiplier: 1.0,
      cameraMoveOverride: "HANDHELD", addNegative: [], warnings: [], rawNotes: "",
    };
    const result = applyDelta(4, "STATIC", [], delta);
    expect(result.cameraMove).toBe("HANDHELD");
  });

  it("adds constraints to tags", () => {
    const delta: PromptDelta = {
      addConstraints: ["lighting:high_key", "mood:tense"], removeConstraints: [],
      durationMultiplier: 1.0, addNegative: [], warnings: [], rawNotes: "",
    };
    const result = applyDelta(4, "PAN", ["screenDirection:L"], delta);
    expect(result.continuityTags).toContain("lighting:high_key");
    expect(result.continuityTags).toContain("mood:tense");
    expect(result.continuityTags).toContain("screenDirection:L");
  });

  it("does not duplicate existing tags", () => {
    const delta: PromptDelta = {
      addConstraints: ["mood:tense"], removeConstraints: [],
      durationMultiplier: 1.0, addNegative: [], warnings: [], rawNotes: "",
    };
    const result = applyDelta(4, "PAN", ["mood:tense"], delta);
    expect(result.continuityTags.filter(t => t === "mood:tense").length).toBe(1);
  });

  it("returns additional negative prompts", () => {
    const delta: PromptDelta = {
      addConstraints: [], removeConstraints: [], durationMultiplier: 1.0,
      addNegative: ["camera shake", "flicker"], warnings: [], rawNotes: "",
    };
    const result = applyDelta(4, "STATIC", [], delta);
    expect(result.additionalNegative).toEqual(["camera shake", "flicker"]);
  });

  it("no-op delta preserves all base values", () => {
    const delta: PromptDelta = {
      addConstraints: [], removeConstraints: [], durationMultiplier: 1.0,
      addNegative: [], warnings: [], rawNotes: "",
    };
    const result = applyDelta(5, "PAN", ["tag:a"], delta);
    expect(result.durationSec).toBe(5);
    expect(result.cameraMove).toBe("PAN");
    expect(result.continuityTags).toEqual(["tag:a"]);
  });
});
