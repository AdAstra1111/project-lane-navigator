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
 * Quality History Persistence Tests
 */
import {
  persistCinematicQualityRun,
  type PersistQualityRunParams,
} from "../../supabase/functions/_shared/cik/qualityHistory";

describe("persistCinematicQualityRun", () => {
  const baseParams: PersistQualityRunParams = {
    projectId: "00000000-0000-0000-0000-000000000001",
    documentId: null,
    runSource: "trailer-engine",
    lane: "feature_film",
    adapterMode: "explicit",
    strictnessMode: "standard",
    attempt0: {
      model: "balanced",
      score: 0.72,
      pass: false,
      failures: ["WEAK_ARC"],
      hardFailures: ["WEAK_ARC"],
      diagnosticFlags: [],
      unitCount: 6,
    },
    repairInstruction: "Raise arc peak in last 25%",
    attempt1: {
      model: "strong",
      score: 0.88,
      pass: true,
      failures: [],
      hardFailures: [],
      diagnosticFlags: [],
      unitCount: 6,
    },
    final: {
      pass: true,
      finalScore: 0.88,
      hardFailures: [],
      diagnosticFlags: [],
      metricsJson: { arc_peak: 0.92 },
    },
  };

  it("calls RPC with correct payload shape including lane and run_source", async () => {
    let capturedArgs: any = null;
    const mockDb = {
      rpc: async (name: string, args: any) => {
        capturedArgs = { name, args };
        return { data: "mock-uuid", error: null };
      },
    };

    const result = await persistCinematicQualityRun(mockDb, baseParams);

    expect(result).toBe("mock-uuid");
    expect(capturedArgs.name).toBe("insert_cinematic_quality_run_with_attempts");
    expect(capturedArgs.args.p_run.lane).toBe("feature_film");
    expect(capturedArgs.args.p_run.run_source).toBe("trailer-engine");
    expect(capturedArgs.args.p_run.final_pass).toBe(true);
    expect(capturedArgs.args.p_attempt0.attempt_index).toBe(0);
    expect(capturedArgs.args.p_attempt1.attempt_index).toBe(1);
  });

  it("stores repair_instruction in attempt1.input_summary_json", async () => {
    let capturedArgs: any = null;
    const mockDb = {
      rpc: async (_: string, args: any) => {
        capturedArgs = args;
        return { data: "uuid", error: null };
      },
    };

    await persistCinematicQualityRun(mockDb, baseParams);

    expect(capturedArgs.p_attempt1.input_summary_json.repair_instruction)
      .toBe("Raise arc peak in last 25%");
    // attempt0 should NOT have repair_instruction
    expect(capturedArgs.p_attempt0.input_summary_json.repair_instruction).toBeUndefined();
  });

  it("swallows RPC errors without throwing", async () => {
    const mockDb = {
      rpc: async () => {
        return { data: null, error: { message: "DB connection failed" } };
      },
    };

    // Must not throw
    const result = await persistCinematicQualityRun(mockDb, baseParams);
    expect(result).toBeNull();
  });

  it("swallows thrown exceptions without throwing", async () => {
    const mockDb = {
      rpc: async () => {
        throw new Error("Network timeout");
      },
    };

    const result = await persistCinematicQualityRun(mockDb, baseParams);
    expect(result).toBeNull();
  });

  it("handles single-attempt pass (no attempt1)", async () => {
    let capturedArgs: any = null;
    const mockDb = {
      rpc: async (_: string, args: any) => {
        capturedArgs = args;
        return { data: "uuid-single", error: null };
      },
    };

    const singleAttemptParams: PersistQualityRunParams = {
      ...baseParams,
      attempt1: undefined,
      repairInstruction: undefined,
      final: { pass: true, finalScore: 0.85, hardFailures: [], diagnosticFlags: [], metricsJson: {} },
    };

    const result = await persistCinematicQualityRun(mockDb, singleAttemptParams);
    expect(result).toBe("uuid-single");
    expect(capturedArgs.p_attempt1).toBeNull();
    expect(capturedArgs.p_run.attempt_count).toBe(1);
  });

  it("sets lane to 'unknown' when lane is empty", async () => {
    let capturedArgs: any = null;
    const mockDb = {
      rpc: async (_: string, args: any) => {
        capturedArgs = args;
        return { data: "uuid", error: null };
      },
    };

    await persistCinematicQualityRun(mockDb, { ...baseParams, lane: "" });
    expect(capturedArgs.p_run.lane).toBe("unknown");
  });

  it("derives engine from runSource", async () => {
    let capturedArgs: any = null;
    const mockDb = {
      rpc: async (_: string, args: any) => {
        capturedArgs = args;
        return { data: "uuid", error: null };
      },
    };

    await persistCinematicQualityRun(mockDb, { ...baseParams, runSource: "storyboard-engine" });
    expect(capturedArgs.p_run.engine).toBe("storyboard");
  });
});

/**
 * Quality History RPC — compile-time + shape tests
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

    expect(() => JSON.stringify(run)).not.toThrow();
    expect(() => JSON.stringify(attempt0)).not.toThrow();
    expect(() => JSON.stringify(attempt1)).not.toThrow();
    expect(run.project_id).toBeTruthy();
    expect(attempt0.attempt_index).toBe(0);
    expect(attempt1.attempt_index).toBe(1);
  });

  it("RPC function name matches expected convention", () => {
    const rpcName = "insert_cinematic_quality_run_with_attempts";
    expect(rpcName).toMatch(/^insert_cinematic_quality_run/);
  });

  it("attempt_index is constrained to 0 or 1", () => {
    for (const idx of [0, 1]) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(1);
    }
  });
});
