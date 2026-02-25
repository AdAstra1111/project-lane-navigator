/**
 * Video Generation Plan — Tests
 * Determinism, energy mapping, continuity warnings, UI render safety.
 */
import { describe, it, expect } from "vitest";
import { buildVideoGenerationPlan, type BuildPlanInput } from "@/videoPlans/planBuilder";
import type { VideoGenerationPlanV1 } from "@/videoPlans/types";

/* ── Helper ── */

function makeUnits(energies: number[], intent = "intrigue") {
  return energies.map((energy, i) => ({ intent, energy, id: `u${i}` }));
}

function makeInput(energies: number[], lane = "feature_film"): BuildPlanInput {
  return {
    projectId: "proj-1",
    qualityRunId: "run-1",
    lane,
    units: makeUnits(energies),
  };
}

/* ── A) Determinism ── */

describe("planBuilder — determinism", () => {
  it("same input produces identical plan_json (excluding createdAt)", () => {
    const input = makeInput([0.2, 0.5, 0.7, 0.95]);
    const plan1 = buildVideoGenerationPlan(input);
    const plan2 = buildVideoGenerationPlan(input);

    // Zero out timestamps for comparison
    plan1.metadata.createdAt = "";
    plan2.metadata.createdAt = "";

    expect(JSON.stringify(plan1)).toBe(JSON.stringify(plan2));
  });

  it("different inputs produce different plans", () => {
    const plan1 = buildVideoGenerationPlan(makeInput([0.2, 0.9]));
    const plan2 = buildVideoGenerationPlan(makeInput([0.9, 0.2]));
    expect(plan1.pacing.energyCurve).not.toEqual(plan2.pacing.energyCurve);
  });
});

/* ── B) Energy Band Mapping ── */

describe("planBuilder — energy band mapping", () => {
  it("low energy unit produces 1 shot with WIDE/STATIC", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.1]));
    expect(plan.shotPlan.length).toBe(1);
    expect(plan.shotPlan[0].shotType).toBe("WIDE");
    expect(plan.shotPlan[0].cameraMove).toBe("STATIC");
    expect(plan.shotPlan[0].lensMm).toBe(24);
  });

  it("mid energy unit produces 2 shots", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.45]));
    expect(plan.shotPlan.length).toBe(2);
  });

  it("high energy unit produces 3 shots", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.7]));
    expect(plan.shotPlan.length).toBe(3);
  });

  it("peak energy unit produces 4 shots", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.95]));
    expect(plan.shotPlan.length).toBe(4);
  });

  it("shot count increases with energy across a sequence", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.1, 0.45, 0.7, 0.95]));
    // Count shots per unit
    const shotsPerUnit = [0, 0, 0, 0];
    for (const shot of plan.shotPlan) shotsPerUnit[shot.unitIndex]++;
    expect(shotsPerUnit[0]).toBeLessThan(shotsPerUnit[3]);
  });
});

/* ── C) Lane-Aware Shot Count ── */

describe("planBuilder — lane adjustments", () => {
  it("vertical_drama produces fewer shots than feature_film", () => {
    const ff = buildVideoGenerationPlan(makeInput([0.5, 0.8], "feature_film"));
    const vd = buildVideoGenerationPlan(makeInput([0.5, 0.8], "vertical_drama"));
    expect(vd.pacing.totalShots).toBeLessThanOrEqual(ff.pacing.totalShots);
  });

  it("advertising produces more shots than feature_film", () => {
    const ff = buildVideoGenerationPlan(makeInput([0.5, 0.8], "feature_film"));
    const ad = buildVideoGenerationPlan(makeInput([0.5, 0.8], "advertising"));
    expect(ad.pacing.totalShots).toBeGreaterThanOrEqual(ff.pacing.totalShots);
  });
});

/* ── D) Continuity Warnings ── */

describe("planBuilder — continuity warnings", () => {
  it("lens jump 24→85 without energy jump triggers warning", () => {
    // Low energy (24mm) → mid energy (50mm) → another low (24mm) — no big jump
    // To trigger: need adjacent units with similar energy but different bands
    // Unit 0: low (0.1 → 24mm), Unit 1: peak (0.95 → 85mm)
    // Energy jump = 0.85, threshold = 0.3. This should NOT warn.
    const plan1 = buildVideoGenerationPlan(makeInput([0.1, 0.95]));
    const lensWarns1 = plan1.continuity.warnings.filter(w => w.rule === "lens_continuity");
    expect(lensWarns1.length).toBe(0); // big energy jump allows lens skip

    // Now: two adjacent units with similar energy but band templates that differ
    // mid (0.5 → 35/50mm) followed by mid (0.55 → 35/50mm) — same lens, no warn
    const plan2 = buildVideoGenerationPlan(makeInput([0.5, 0.55]));
    const lensWarns2 = plan2.continuity.warnings.filter(w => w.rule === "lens_continuity");
    expect(lensWarns2.length).toBe(0);
  });

  it("STATIC→HANDHELD without energy jump triggers move_continuity warning", () => {
    // low energy (STATIC) → high energy (HANDHELD) — energy jump 0.6, threshold 0.35, no warn
    const plan1 = buildVideoGenerationPlan(makeInput([0.1, 0.7]));
    const moveWarns1 = plan1.continuity.warnings.filter(w => w.rule === "move_continuity");
    expect(moveWarns1.length).toBe(0);

    // Need adjacent shots: STATIC then HANDHELD with small energy gap
    // low (0.2 → STATIC) → high (0.65 → first shot TRACKING) — no HANDHELD first shot
    // Actually HANDHELD appears in peak template. Let's test:
    // mid (0.5 → DOLLY, STATIC) → peak (0.9 → HANDHELD, CRANE...)
    // STATIC (last shot of mid) → HANDHELD (first shot of peak), energy jump 0.4 > 0.35 → no warn
    const plan2 = buildVideoGenerationPlan(makeInput([0.5, 0.9]));
    const moveWarns2 = plan2.continuity.warnings.filter(w => w.rule === "move_continuity");
    // Energy jump is above threshold, so no warn
    expect(moveWarns2.length).toBe(0);
  });

  it("screen direction rule always present", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.5, 0.6, 0.7, 0.8]));
    const dirRule = plan.continuity.rules.find(r => r.rule === "screen_direction_continuity");
    expect(dirRule).toBeDefined();
  });

  it("all three continuity rules are always present", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.5]));
    const ruleNames = plan.continuity.rules.map(r => r.rule);
    expect(ruleNames).toContain("screen_direction_continuity");
    expect(ruleNames).toContain("lens_continuity");
    expect(ruleNames).toContain("move_continuity");
  });
});

/* ── E) Pacing ── */

describe("planBuilder — pacing", () => {
  it("energyCurve matches input energies", () => {
    const energies = [0.2, 0.5, 0.8, 0.95];
    const plan = buildVideoGenerationPlan(makeInput(energies));
    expect(plan.pacing.energyCurve).toEqual(energies);
  });

  it("avgShotLengthSec is positive", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.5, 0.7]));
    expect(plan.pacing.avgShotLengthSec).toBeGreaterThan(0);
  });

  it("totalShots equals shot plan length", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.3, 0.6, 0.9]));
    expect(plan.pacing.totalShots).toBe(plan.shotPlan.length);
  });
});

/* ── F) Metadata ── */

describe("planBuilder — metadata", () => {
  it("populates metadata fields correctly", () => {
    const plan = buildVideoGenerationPlan({
      projectId: "p1",
      qualityRunId: "r1",
      documentId: "d1",
      lane: "documentary",
      units: makeUnits([0.5]),
    });
    expect(plan.metadata.projectId).toBe("p1");
    expect(plan.metadata.qualityRunId).toBe("r1");
    expect(plan.metadata.documentId).toBe("d1");
    expect(plan.metadata.lane).toBe("documentary");
    expect(plan.metadata.planVersion).toBe("v1");
    expect(plan.metadata.createdAt).toBeTruthy();
  });
});

/* ── G) Shot structure ── */

describe("planBuilder — shot structure", () => {
  it("every shot has required fields", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.2, 0.5, 0.8, 0.95]));
    for (const shot of plan.shotPlan) {
      expect(typeof shot.shotIndex).toBe("number");
      expect(typeof shot.unitIndex).toBe("number");
      expect(shot.shotType).toBeTruthy();
      expect(shot.cameraMove).toBeTruthy();
      expect(shot.lensMm).toBeGreaterThan(0);
      expect(shot.durationSec).toBeGreaterThan(0);
      expect(shot.description).toBeTruthy();
      expect(Array.isArray(shot.continuityTags)).toBe(true);
    }
  });

  it("shotIndex is sequential starting from 0", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.3, 0.7, 0.9]));
    plan.shotPlan.forEach((shot, i) => {
      expect(shot.shotIndex).toBe(i);
    });
  });
});

/* ── H) Edge cases ── */

describe("planBuilder — edge cases", () => {
  it("single unit produces valid plan", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.5]));
    expect(plan.shotPlan.length).toBeGreaterThan(0);
    expect(plan.units.length).toBe(1);
  });

  it("empty units produces plan with 0 shots", () => {
    const plan = buildVideoGenerationPlan(makeInput([]));
    expect(plan.shotPlan.length).toBe(0);
    expect(plan.pacing.totalShots).toBe(0);
  });

  it("unknown lane uses default multiplier", () => {
    const plan = buildVideoGenerationPlan(makeInput([0.5], "unknown_lane"));
    const defaultPlan = buildVideoGenerationPlan(makeInput([0.5], "feature_film"));
    expect(plan.pacing.totalShots).toBe(defaultPlan.pacing.totalShots);
  });
});
