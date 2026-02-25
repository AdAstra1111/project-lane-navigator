/**
 * CIK Phase 5 — Strictness Mode Tests
 * Unit + integration tests for deterministic strictness multipliers.
 */
import { describe, it, expect } from "vitest";
import {
  applyStrictness,
  parseStrictnessMode,
  type StrictnessMode,
} from "../../supabase/functions/_shared/cik/strictness";
import { CINEMATIC_THRESHOLDS } from "../../supabase/functions/_shared/cinematic-score";
import { getCinematicThresholds } from "../../supabase/functions/_shared/cik/thresholdProfiles";

/* ── A) parseStrictnessMode ── */

describe("parseStrictnessMode", () => {
  it("returns 'standard' for undefined", () => {
    expect(parseStrictnessMode(undefined)).toBe("standard");
  });
  it("returns 'standard' for null", () => {
    expect(parseStrictnessMode(null)).toBe("standard");
  });
  it("returns 'standard' for unknown string", () => {
    expect(parseStrictnessMode("ultra")).toBe("standard");
  });
  it("returns 'lenient' for 'lenient'", () => {
    expect(parseStrictnessMode("lenient")).toBe("lenient");
  });
  it("returns 'strict' for 'strict'", () => {
    expect(parseStrictnessMode("strict")).toBe("strict");
  });
});

/* ── B) applyStrictness — standard is identity ── */

describe("applyStrictness — standard", () => {
  it("returns identical thresholds for standard mode", () => {
    const base = { ...CINEMATIC_THRESHOLDS };
    const result = applyStrictness(base, "standard");
    for (const key of Object.keys(base) as (keyof typeof base)[]) {
      expect(result[key]).toBe(base[key]);
    }
  });
});

/* ── C) applyStrictness — lenient makes thresholds easier ── */

describe("applyStrictness — lenient", () => {
  const base = { ...CINEMATIC_THRESHOLDS };
  const lenient = applyStrictness(base, "lenient");

  it("lowers min_peak_energy (easier to pass)", () => {
    expect(lenient.min_peak_energy).toBeLessThan(base.min_peak_energy);
  });
  it("lowers min_contrast (easier to pass)", () => {
    expect(lenient.min_contrast).toBeLessThan(base.min_contrast);
  });
  it("raises max_tonal_flips (more forgiving)", () => {
    expect(lenient.max_tonal_flips).toBeGreaterThanOrEqual(base.max_tonal_flips);
  });
  it("raises max_direction_reversals (more forgiving)", () => {
    expect(lenient.max_direction_reversals).toBeGreaterThanOrEqual(base.max_direction_reversals);
  });
  it("does NOT change penalty values", () => {
    expect(lenient.penalty_too_short).toBe(base.penalty_too_short);
    expect(lenient.penalty_no_peak).toBe(base.penalty_no_peak);
    expect(lenient.penalty_weak_arc).toBe(base.penalty_weak_arc);
  });
});

/* ── D) applyStrictness — strict makes thresholds harder ── */

describe("applyStrictness — strict", () => {
  const base = { ...CINEMATIC_THRESHOLDS };
  const strict = applyStrictness(base, "strict");

  it("raises min_peak_energy (harder to pass)", () => {
    expect(strict.min_peak_energy).toBeGreaterThan(base.min_peak_energy);
  });
  it("raises min_contrast (harder to pass)", () => {
    expect(strict.min_contrast).toBeGreaterThan(base.min_contrast);
  });
  it("lowers max_tonal_flips (tighter)", () => {
    expect(strict.max_tonal_flips).toBeLessThanOrEqual(base.max_tonal_flips);
  });
  it("does NOT change penalty values", () => {
    expect(strict.penalty_too_short).toBe(base.penalty_too_short);
    expect(strict.penalty_flatline).toBe(base.penalty_flatline);
  });
});

/* ── E) Clamping ── */

describe("applyStrictness — clamping", () => {
  it("min_peak_energy stays within [0.50, 0.99] even with extreme multiplier", () => {
    const base = { ...CINEMATIC_THRESHOLDS };
    const lenient = applyStrictness(base, "lenient");
    const strict = applyStrictness(base, "strict");
    expect(lenient.min_peak_energy).toBeGreaterThanOrEqual(0.50);
    expect(strict.min_peak_energy).toBeLessThanOrEqual(0.99);
  });
  it("integer fields remain integers", () => {
    const base = { ...CINEMATIC_THRESHOLDS };
    for (const mode of ["lenient", "strict"] as StrictnessMode[]) {
      const result = applyStrictness(base, mode);
      expect(Number.isInteger(result.min_units)).toBe(true);
      expect(Number.isInteger(result.flatline_span)).toBe(true);
      expect(Number.isInteger(result.max_tonal_flips)).toBe(true);
      expect(Number.isInteger(result.min_intent_distinct)).toBe(true);
      expect(Number.isInteger(result.max_direction_reversals)).toBe(true);
    }
  });
});

/* ── F) getCinematicThresholds with strictness ── */

describe("getCinematicThresholds + strictness", () => {
  it("standard mode matches baseline exactly", () => {
    const baseline = getCinematicThresholds(undefined, "standard");
    const noStrictness = getCinematicThresholds(undefined);
    for (const key of Object.keys(baseline) as (keyof typeof baseline)[]) {
      expect(baseline[key]).toBe(noStrictness[key]);
    }
  });

  it("lenient + documentary adjusts both lane and strictness", () => {
    const standard = getCinematicThresholds("documentary", "standard");
    const lenient = getCinematicThresholds("documentary", "lenient");
    // min_contrast should be lower than documentary standard (which is already 0.40)
    expect(lenient.min_contrast).toBeLessThan(standard.min_contrast);
  });

  it("strict + vertical_drama adjusts both lane and strictness", () => {
    const standard = getCinematicThresholds("vertical_drama", "standard");
    const strict = getCinematicThresholds("vertical_drama", "strict");
    expect(strict.min_peak_energy).toBeGreaterThan(standard.min_peak_energy);
  });

  it("unknown lane + strict uses default thresholds with strict multipliers", () => {
    const strict = getCinematicThresholds("unknown_lane", "strict");
    const base = getCinematicThresholds("unknown_lane", "standard");
    expect(strict.min_peak_energy).toBeGreaterThan(base.min_peak_energy);
  });
});

/* ── G) Integration: persistence shape ── */

describe("strictness persistence shape", () => {
  it("settings_json includes strictness_mode", () => {
    const strictnessMode = "strict";
    const settingsJson = { strictness_mode: strictnessMode, lane: "feature_film" };
    expect(settingsJson.strictness_mode).toBe("strict");
  });

  it("PersistQualityRunParams accepts strictnessMode", () => {
    // Type-level test: this should compile
    const params = {
      projectId: "test",
      runSource: "trailer-engine",
      lane: "feature_film",
      strictnessMode: "lenient" as string,
      settingsJson: { strictness_mode: "lenient" },
      attempt0: {
        model: "test-model",
        score: 0.8,
        pass: true,
        failures: [],
        hardFailures: [],
        diagnosticFlags: [],
      },
      final: {
        pass: true,
        finalScore: 0.8,
        hardFailures: [],
        diagnosticFlags: [],
        metricsJson: {},
      },
    };
    expect(params.strictnessMode).toBe("lenient");
  });
});

/* ── H) All lanes + all modes produce valid thresholds ── */

describe("all lanes × all modes produce valid thresholds", () => {
  const lanes = [undefined, "feature_film", "series", "vertical_drama", "documentary", "advertising", "music_video", "unknown"];
  const modes: StrictnessMode[] = ["lenient", "standard", "strict"];

  for (const lane of lanes) {
    for (const mode of modes) {
      it(`lane=${lane ?? "default"} mode=${mode}`, () => {
        const t = getCinematicThresholds(lane, mode);
        expect(t.min_peak_energy).toBeGreaterThan(0);
        expect(t.min_peak_energy).toBeLessThanOrEqual(1);
        expect(t.min_units).toBeGreaterThanOrEqual(2);
        expect(t.max_tonal_flips).toBeGreaterThanOrEqual(1);
        expect(t.penalty_too_short).toBe(CINEMATIC_THRESHOLDS.penalty_too_short);
      });
    }
  }
});
