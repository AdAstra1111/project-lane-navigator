/**
 * LLM MODELS Drift Guard — CIK vs General Shared Constants
 *
 * supabase/functions/_shared/cik/modelRouter.ts defines MODELS for the
 * cinematic quality-gate pipeline (FAST / BALANCED / STRONG / STRUCTURED).
 *
 * supabase/functions/_shared/llm.ts defines MODELS for general edge-function
 * use (PRO / BALANCED / FAST / FAST_LITE).
 *
 * These two constant blocks intentionally diverge on BALANCED:
 *   - CIK BALANCED = gemini-2.5-pro  (heavier model for cinematic scoring)
 *   - LLM BALANCED = gemini-3-flash-preview (cost-effective for general tasks)
 *
 * This test file makes overlapping keys explicit so accidental drift is caught.
 */
import { describe, it, expect } from "vitest";

// CIK cinematic router MODELS (not exported directly — reimport the module)
// The file exports routeModel which uses these internally; we access them
// via a re-export trick. Since the const is not exported, we read the file's
// known values through routeModel behavior. However the constants ARE in
// scope — we import the whole module namespace.
import * as CikRouter from "../../supabase/functions/_shared/cik/modelRouter";

// General shared LLM constants
import { MODELS as LLM_MODELS } from "../../supabase/functions/_shared/llm";

/*
 * CIK MODELS is not exported by name, so we extract known values via routeModel.
 * This keeps the test honest — it tests actual runtime behavior, not copy-pasted strings.
 */
function getCikModelForCase(engine: "trailer", lane: string, attemptIndex: number, priorFailures?: string[]) {
  return CikRouter.routeModel({ engine, lane, attemptIndex, priorFailures }).model;
}

describe("LLM MODELS drift guard: CIK vs General", () => {
  /* ── A) FAST must match ── */

  it("FAST: CIK trailer attempt-0 short-form uses same model as LLM.FAST", () => {
    // CIK routeModel returns MODELS.FAST for short-form lanes at attempt 0
    const cikFast = getCikModelForCase("trailer", "vertical_drama", 0);
    expect(cikFast).toBe(LLM_MODELS.FAST);
  });

  it("LLM.FAST is a non-empty string", () => {
    expect(LLM_MODELS.FAST).toBeTruthy();
    expect(typeof LLM_MODELS.FAST).toBe("string");
  });

  /* ── B) FAST_LITE exists in LLM only ── */

  it("LLM.FAST_LITE exists and is a non-empty string (no CIK equivalent required)", () => {
    expect(LLM_MODELS.FAST_LITE).toBeTruthy();
    expect(typeof LLM_MODELS.FAST_LITE).toBe("string");
  });

  /* ── C) BALANCED: intentional divergence ── */

  it("BALANCED intentionally diverges: CIK uses heavier model for cinematic scoring", () => {
    // CIK BALANCED = the model used for trailer/storyboard attempt 0 (non-short-form)
    const cikBalanced = getCikModelForCase("trailer", "feature_film", 0);
    // LLM BALANCED = general-purpose balanced model
    const llmBalanced = LLM_MODELS.BALANCED;

    // Assert they are DIFFERENT — this is intentional.
    // CIK cinematic pipeline needs gemini-2.5-pro for quality scoring;
    // general edge functions use gemini-3-flash-preview for cost efficiency.
    expect(cikBalanced).not.toBe(llmBalanced);

    // Guard the specific known values so any change is caught
    expect(cikBalanced).toBe("google/gemini-2.5-pro");
    expect(llmBalanced).toBe("google/gemini-3-flash-preview");
  });

  /* ── D) PRO: LLM.PRO matches CIK BALANCED (both gemini-2.5-pro) ── */

  it("LLM.PRO equals CIK BALANCED (gemini-2.5-pro)", () => {
    const cikBalanced = getCikModelForCase("trailer", "feature_film", 0);
    expect(LLM_MODELS.PRO).toBe(cikBalanced);
  });

  /* ── E) All model strings are valid format ── */

  it("all LLM MODELS follow provider/model-name format", () => {
    for (const [key, value] of Object.entries(LLM_MODELS)) {
      expect(value, `LLM.MODELS.${key}`).toMatch(/^[a-z]+\/[a-z0-9._-]+$/i);
    }
  });
});
