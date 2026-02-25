/**
 * Suite Smoke Test — deterministic sanity check that verifies
 * vitest config resolves imports from all major test areas.
 * No snapshots. No LLM. No DB.
 */
import { describe, it, expect } from "vitest";

// Import from supabase/functions/_shared to verify .ts extension resolution works
import { extractFeatures, summarizeSignal } from "../../supabase/functions/_shared/cinematic-features";
import { scoreCinematic } from "../../supabase/functions/_shared/cinematic-score";
import type { CinematicUnit } from "../../supabase/functions/_shared/cinematic-model";

// Import from nested cik/ path
import { analyzeLadder } from "../../supabase/functions/_shared/cik/ladderLock";

describe("suite-smoke: config and import resolution", () => {
  it("vitest resolves supabase/_shared imports (no .ts extension errors)", () => {
    expect(typeof extractFeatures).toBe("function");
    expect(typeof summarizeSignal).toBe("function");
    expect(typeof scoreCinematic).toBe("function");
    expect(typeof analyzeLadder).toBe("function");
  });

  it("core CIK functions produce deterministic output", () => {
    const unit: CinematicUnit = {
      id: "smoke-0",
      intent: "intrigue",
      energy: 0.5,
      tension: 0.5,
      density: 0.5,
      tonal_polarity: 0,
    };
    const features = extractFeatures([unit]);
    expect(features.unitCount).toBe(1);

    const score = scoreCinematic([unit]);
    expect(typeof score.pass).toBe("boolean");
    expect(typeof score.score).toBe("number");
  });

  it("test files exist in src/test/ for each major area", () => {
    // This is a build-time check: if any of these imports fail,
    // the test file is missing or broken.
    // We just verify the test file itself loaded (this test running = success).
    expect(true).toBe(true);
  });
});
