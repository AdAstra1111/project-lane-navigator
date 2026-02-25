/**
 * CIK Model Router — Unit + Integration Tests (Phase 3)
 */
import { describe, it, expect } from "vitest";
import {
  selectCikModel,
  CIK_MODEL_ATTEMPT0_DEFAULT,
  CIK_MODEL_ATTEMPT1_STRONG,
} from "@/config/cikModels";

describe("selectCikModel", () => {
  /* ── A) Attempt 0 always returns cheap model ── */

  it("attempt 0 returns default cheap model", () => {
    const result = selectCikModel({ attemptIndex: 0, lane: "feature_film" });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(result.reason).toBe("attempt0_default");
  });

  it("attempt 0 returns default for unknown lane", () => {
    const result = selectCikModel({ attemptIndex: 0, lane: "unknown_lane_xyz" });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(result.reason).toBe("attempt0_default");
  });

  it("attempt 0 ignores hard failures param", () => {
    const result = selectCikModel({
      attemptIndex: 0,
      lane: "series",
      attempt0HardFailures: ["WEAK_ARC", "FLATLINE"],
    });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(result.reason).toBe("attempt0_default");
  });

  /* ── B) Attempt 1 with hard failures returns strong model ── */

  it("attempt 1 returns strong model when hard failures present", () => {
    const result = selectCikModel({
      attemptIndex: 1,
      lane: "documentary",
      attempt0HardFailures: ["WEAK_ARC"],
    });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT1_STRONG);
    expect(result.reason).toBe("attempt1_strong_due_to_hard_failures");
  });

  it("attempt 1 returns strong model with multiple hard failures", () => {
    const result = selectCikModel({
      attemptIndex: 1,
      lane: "vertical_drama",
      attempt0HardFailures: ["WEAK_ARC", "ENERGY_DROP", "FLATLINE"],
    });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT1_STRONG);
    expect(result.reason).toBe("attempt1_strong_due_to_hard_failures");
  });

  /* ── C) Attempt 1 without hard failures returns default ── */

  it("attempt 1 returns default when no hard failures", () => {
    const result = selectCikModel({
      attemptIndex: 1,
      lane: "documentary",
      attempt0HardFailures: [],
    });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(result.reason).toBe("attempt1_default_no_hard_failures");
  });

  it("attempt 1 returns default when hard failures undefined", () => {
    const result = selectCikModel({
      attemptIndex: 1,
      lane: "series",
    });
    expect(result.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(result.reason).toBe("attempt1_default_no_hard_failures");
  });

  /* ── D) Lane overrides ── */

  it("feature_film attempt 1 with failures uses GPT-5", () => {
    const result = selectCikModel({
      attemptIndex: 1,
      lane: "feature_film",
      attempt0HardFailures: ["WEAK_ARC"],
    });
    expect(result.model).toBe("openai/gpt-5");
    expect(result.reason).toBe("attempt1_strong_due_to_hard_failures");
  });

  it("series attempt 1 with failures uses GPT-5", () => {
    const result = selectCikModel({
      attemptIndex: 1,
      lane: "series",
      attempt0HardFailures: ["FLATLINE"],
    });
    expect(result.model).toBe("openai/gpt-5");
  });

  it("unknown lane uses defaults for both attempts", () => {
    const a0 = selectCikModel({ attemptIndex: 0, lane: "made_up_lane" });
    const a1 = selectCikModel({ attemptIndex: 1, lane: "made_up_lane", attempt0HardFailures: ["X"] });
    expect(a0.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(a1.model).toBe(CIK_MODEL_ATTEMPT1_STRONG);
  });

  /* ── E) Determinism ── */

  it("same input always gives same output", () => {
    const params = { attemptIndex: 1 as const, lane: "feature_film", attempt0HardFailures: ["WEAK_ARC"] };
    const r1 = selectCikModel(params);
    const r2 = selectCikModel(params);
    expect(r1).toEqual(r2);
  });

  /* ── F) Reason strings ── */

  it("reason strings are one of the three expected values", () => {
    const reasons = new Set<string>();
    reasons.add(selectCikModel({ attemptIndex: 0, lane: "x" }).reason);
    reasons.add(selectCikModel({ attemptIndex: 1, lane: "x", attempt0HardFailures: ["A"] }).reason);
    reasons.add(selectCikModel({ attemptIndex: 1, lane: "x", attempt0HardFailures: [] }).reason);
    expect(reasons).toEqual(new Set([
      "attempt0_default",
      "attempt1_strong_due_to_hard_failures",
      "attempt1_default_no_hard_failures",
    ]));
  });
});

/* ── Integration: simulated run with router decisions ── */

describe("CIK router integration", () => {
  it("simulated two-attempt run records router decisions correctly", () => {
    const a0Router = selectCikModel({ attemptIndex: 0, lane: "feature_film" });
    expect(a0Router.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);

    const attempt0HardFailures = ["WEAK_ARC", "ENERGY_DROP"];
    const a1Router = selectCikModel({
      attemptIndex: 1,
      lane: "feature_film",
      attempt0HardFailures,
    });
    expect(a1Router.model).toBe("openai/gpt-5");

    // Build metrics_json with router info (as persisted)
    const metricsJson = {
      model_router: {
        attempt0: { model: a0Router.model, reason: a0Router.reason },
        attempt1: { model: a1Router.model, reason: a1Router.reason },
      },
    };

    expect(metricsJson.model_router.attempt0.reason).toBe("attempt0_default");
    expect(metricsJson.model_router.attempt1.reason).toBe("attempt1_strong_due_to_hard_failures");
    expect(metricsJson.model_router.attempt1.model).toBe("openai/gpt-5");
  });

  it("passing attempt 0 would select default for attempt 1 if invoked", () => {
    const a0 = selectCikModel({ attemptIndex: 0, lane: "documentary" });
    const a1 = selectCikModel({
      attemptIndex: 1,
      lane: "documentary",
      attempt0HardFailures: [],
    });
    expect(a0.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(a1.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(a1.reason).toBe("attempt1_default_no_hard_failures");
  });

  it("persistence payload includes router reasons in metrics_json", () => {
    const a0 = selectCikModel({ attemptIndex: 0, lane: "series" });
    const a1 = selectCikModel({ attemptIndex: 1, lane: "series", attempt0HardFailures: ["FLATLINE"] });

    const persistPayload = {
      p_run: {
        metrics_json: {
          model_router: {
            attempt0: { model: a0.model, reason: a0.reason },
            attempt1: { model: a1.model, reason: a1.reason },
          },
        },
      },
      p_attempt0: { model: a0.model },
      p_attempt1: { model: a1.model },
    };

    expect(persistPayload.p_attempt0.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(persistPayload.p_attempt1.model).toBe("openai/gpt-5");
    expect(persistPayload.p_run.metrics_json.model_router.attempt0.reason).toBe("attempt0_default");
  });

  it("telemetry event model_router shape matches expectation", () => {
    const a0 = selectCikModel({ attemptIndex: 0, lane: "vertical_drama" });
    const event: Record<string, any> = {
      handler: "trailer-engine",
      phase: "test",
      model: a0.model,
      attempt: 0,
      pass: true,
      score: 0.85,
      failures: [],
      metrics: {},
      model_router: {
        attempt0: { model: a0.model, reason: a0.reason },
      },
    };

    expect(event.model_router.attempt0.model).toBe(CIK_MODEL_ATTEMPT0_DEFAULT);
    expect(event.model_router.attempt0.reason).toBe("attempt0_default");
    expect(event.model_router.attempt1).toBeUndefined();
  });

  it("telemetry event includes attempt1 when repair runs", () => {
    const a0 = selectCikModel({ attemptIndex: 0, lane: "feature_film" });
    const a1 = selectCikModel({ attemptIndex: 1, lane: "feature_film", attempt0HardFailures: ["WEAK_ARC"] });
    const event: Record<string, any> = {
      model_router: {
        attempt0: { model: a0.model, reason: a0.reason },
        attempt1: { model: a1.model, reason: a1.reason },
      },
    };

    expect(event.model_router.attempt1).toBeDefined();
    expect(event.model_router.attempt1.model).toBe("openai/gpt-5");
  });
});
