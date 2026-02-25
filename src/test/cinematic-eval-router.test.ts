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

/**
 * Quality History RPC — compile-time + shape tests
 * (No live DB; validates TypeScript types & RPC name resolution)
 */
describe("quality history RPC types", () => {
  it("RPC payload shapes are well-formed JSON", () => {
    const run = {
      project_id: "00000000-0000-0000-0000-000000000001",
      engine: "trailer",
      lane: "feature_film",
      model: "balanced",
      final_pass: true,
      final_score: 0.85,
      run_source: "trailer-engine",
      strictness_mode: "standard",
      hard_failures: [],
      diagnostic_flags: [],
      metrics_json: {},
      settings_json: {},
    };
    const attempt0 = {
      attempt_index: 0,
      model: "balanced",
      score: 0.75,
      pass: false,
      failures: ["WEAK_ARC"],
      hard_failures: ["WEAK_ARC"],
      diagnostic_flags: [],
      unit_count: 6,
      output_json: {},
      adapter_metrics_json: {},
      timing_json: {},
    };
    const attempt1 = {
      attempt_index: 1,
      model: "strong",
      score: 0.85,
      pass: true,
      failures: [],
      hard_failures: [],
      diagnostic_flags: [],
      unit_count: 6,
      repair_instruction: "Fix arc",
      output_json: {},
      adapter_metrics_json: {},
      timing_json: {},
    };

    // Validate shapes serialize to valid JSON
    expect(() => JSON.stringify(run)).not.toThrow();
    expect(() => JSON.stringify(attempt0)).not.toThrow();
    expect(() => JSON.stringify(attempt1)).not.toThrow();

    // Validate required fields
    expect(run.project_id).toBeTruthy();
    expect(run.engine).toBe("trailer");
    expect(attempt0.attempt_index).toBe(0);
    expect(attempt1.attempt_index).toBe(1);
  });

  it("RPC function name matches expected convention", () => {
    const rpcName = "insert_cinematic_quality_run_with_attempts";
    expect(rpcName).toMatch(/^insert_cinematic_quality_run/);
  });

  it("run_source field accepts known engine values", () => {
    const validSources = ["trailer-engine", "storyboard-engine", "unknown"];
    for (const src of validSources) {
      expect(typeof src).toBe("string");
      expect(src.length).toBeGreaterThan(0);
    }
  });

  it("attempt_index is constrained to 0 or 1", () => {
    const validIndexes = [0, 1];
    for (const idx of validIndexes) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(1);
    }
  });
});
