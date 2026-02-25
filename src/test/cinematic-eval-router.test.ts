/**
 * CIK Eval Harness + Model Router Tests
 */
import { describe, it, expect } from "vitest";

// Eval runner
import { runEvalFixture, runEvalSuite, type EvalFixture } from "../../supabase/functions/_shared/cik/evals/evalRunner";
// Model router
import { routeModel } from "../../supabase/functions/_shared/cik/modelRouter";

function u(id: string, energy: number, tension: number, density: number, polarity: number, intent: string) {
  return { id, energy, tension, density, tonal_polarity: polarity, intent: intent as any };
}

describe("eval harness", () => {
  it("passing fixture returns passed=true", () => {
    const fixture: EvalFixture = {
      name: "test_pass",
      units: [
        u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
        u("1", 0.50, 0.50, 0.45, 0.0, "wonder"),
        u("2", 0.65, 0.65, 0.55, 0.1, "threat"),
        u("3", 0.80, 0.80, 0.70, 0.2, "chaos"),
        u("4", 0.90, 0.90, 0.82, 0.3, "emotion"),
        u("5", 0.95, 0.95, 0.90, 0.4, "release"),
      ],
      expectedPass: true,
    };
    const result = runEvalFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.mismatches).toEqual([]);
  });

  it("failing fixture detects expected failures", () => {
    const fixture: EvalFixture = {
      name: "test_fail",
      units: [
        u("0", 0.50, 0.50, 0.50, 0.0, "intrigue"),
        u("1", 0.50, 0.50, 0.50, 0.0, "intrigue"),
        u("2", 0.50, 0.50, 0.50, 0.0, "intrigue"),
        u("3", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      ],
      expectedPass: false,
      expectedFailures: ["FLATLINE"],
    };
    const result = runEvalFixture(fixture);
    expect(result.passed).toBe(true);
    expect(result.actualPass).toBe(false);
  });

  it("forbidden failures cause mismatch", () => {
    const fixture: EvalFixture = {
      name: "test_forbidden",
      units: [
        u("0", 0.50, 0.50, 0.50, 0.0, "intrigue"),
        u("1", 0.50, 0.50, 0.50, 0.0, "intrigue"),
        u("2", 0.50, 0.50, 0.50, 0.0, "intrigue"),
        u("3", 0.50, 0.50, 0.50, 0.0, "intrigue"),
      ],
      expectedPass: false,
      forbiddenFailures: ["FLATLINE"],
    };
    const result = runEvalFixture(fixture);
    expect(result.passed).toBe(false);
    expect(result.mismatches.some(m => m.includes("FLATLINE"))).toBe(true);
  });

  it("suite runner aggregates results", () => {
    const fixtures: EvalFixture[] = [
      {
        name: "pass1",
        units: [
          u("0", 0.30, 0.30, 0.30, -0.2, "intrigue"),
          u("1", 0.50, 0.50, 0.45, 0.0, "wonder"),
          u("2", 0.70, 0.70, 0.60, 0.1, "threat"),
          u("3", 0.85, 0.85, 0.75, 0.2, "chaos"),
          u("4", 0.92, 0.92, 0.85, 0.3, "emotion"),
          u("5", 0.95, 0.95, 0.90, 0.4, "release"),
        ],
        expectedPass: true,
      },
      {
        name: "fail1",
        units: [u("0", 0.50, 0.50, 0.50, 0.0, "intrigue")],
        expectedPass: false,
        expectedFailures: ["TOO_SHORT"],
      },
    ];
    const suite = runEvalSuite(fixtures);
    expect(suite.totalPassed).toBe(2);
    expect(suite.totalFailed).toBe(0);
  });
});

describe("model router", () => {
  it("attempt 0 uses cost-effective model", () => {
    const decision = routeModel({
      engine: "trailer",
      attemptIndex: 0,
    });
    expect(decision.reasons).toContain("trailer_default");
    expect(decision.model).toContain("gemini");
  });

  it("short-form lanes use fast model on attempt 0", () => {
    const decision = routeModel({
      engine: "trailer",
      lane: "vertical_drama",
      attemptIndex: 0,
    });
    expect(decision.reasons).toContain("short_form_lane");
    expect(decision.model).toContain("flash");
  });

  it("structural failures escalate on attempt 1", () => {
    const decision = routeModel({
      engine: "trailer",
      lane: "feature_film",
      priorFailures: ["WEAK_ARC", "ENERGY_DROP"],
      attemptIndex: 1,
    });
    expect(decision.reasons).toContain("structural_failures");
    expect(decision.reasons).toContain("premium_lane");
  });

  it("low adapter quality uses structured model on repair", () => {
    const decision = routeModel({
      engine: "storyboard",
      adapterQualityPercent: 0.5,
      attemptIndex: 1,
    });
    expect(decision.reasons).toContain("low_adapter_quality");
  });

  it("standard repair without escalation triggers", () => {
    const decision = routeModel({
      engine: "trailer",
      priorFailures: ["LOW_INTENT_DIVERSITY"],
      attemptIndex: 1,
    });
    expect(decision.reasons).toContain("standard_repair");
  });

  it("deterministic: same input always gives same output", () => {
    const input = { engine: "trailer" as const, lane: "series", attemptIndex: 0 };
    const d1 = routeModel(input);
    const d2 = routeModel(input);
    expect(d1).toEqual(d2);
  });
});
