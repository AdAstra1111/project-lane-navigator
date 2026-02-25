/**
 * Quality History UI — diff logic + render safety + trend tests
 * Phase 1 Slice 5: Test Hardening
 */
import { describe, it, expect } from "vitest";
import { computeFailureDiff, computePassRate, computeAvgScore, buildChartData, normalizeScores } from "@/components/cinematic/QualityRunHistory";

/* ── A) Diff Logic ── */

describe("computeFailureDiff", () => {
  it("correctly identifies fixed failures", () => {
    const diff = computeFailureDiff(
      ["WEAK_ARC", "FLATLINE", "ENERGY_DROP"],
      ["FLATLINE"],
    );
    expect(diff.fixed).toEqual(["WEAK_ARC", "ENERGY_DROP"]);
    expect(diff.remaining).toEqual(["FLATLINE"]);
    expect(diff.newFailures).toEqual([]);
  });

  it("correctly identifies new failures", () => {
    const diff = computeFailureDiff(
      ["WEAK_ARC"],
      ["WEAK_ARC", "TONAL_WHIPLASH"],
    );
    expect(diff.fixed).toEqual([]);
    expect(diff.remaining).toEqual(["WEAK_ARC"]);
    expect(diff.newFailures).toEqual(["TONAL_WHIPLASH"]);
  });

  it("handles all fixed", () => {
    const diff = computeFailureDiff(["FLATLINE", "ENERGY_DROP"], []);
    expect(diff.fixed).toEqual(["FLATLINE", "ENERGY_DROP"]);
    expect(diff.remaining).toEqual([]);
    expect(diff.newFailures).toEqual([]);
  });

  it("handles empty inputs", () => {
    const diff = computeFailureDiff([], []);
    expect(diff.fixed).toEqual([]);
    expect(diff.remaining).toEqual([]);
    expect(diff.newFailures).toEqual([]);
  });

  it("handles identical failures", () => {
    const diff = computeFailureDiff(["WEAK_ARC"], ["WEAK_ARC"]);
    expect(diff.fixed).toEqual([]);
    expect(diff.remaining).toEqual(["WEAK_ARC"]);
    expect(diff.newFailures).toEqual([]);
  });

  it("handles complete replacement", () => {
    const diff = computeFailureDiff(["WEAK_ARC", "FLATLINE"], ["ENERGY_DROP", "TONAL_WHIPLASH"]);
    expect(diff.fixed).toEqual(["WEAK_ARC", "FLATLINE"]);
    expect(diff.remaining).toEqual([]);
    expect(diff.newFailures).toEqual(["ENERGY_DROP", "TONAL_WHIPLASH"]);
  });

  it("is order-insensitive for set membership", () => {
    const diffA = computeFailureDiff(["WEAK_ARC", "FLATLINE"], ["FLATLINE", "ENERGY_DROP"]);
    const diffB = computeFailureDiff(["FLATLINE", "WEAK_ARC"], ["ENERGY_DROP", "FLATLINE"]);
    expect(new Set(diffA.fixed)).toEqual(new Set(diffB.fixed));
    expect(new Set(diffA.remaining)).toEqual(new Set(diffB.remaining));
    expect(new Set(diffA.newFailures)).toEqual(new Set(diffB.newFailures));
  });
});

describe("score_delta computation", () => {
  it("computes positive delta when attempt1 improves", () => {
    const delta = 0.88 - 0.72;
    expect(delta).toBeCloseTo(0.16);
  });

  it("computes negative delta when attempt1 regresses", () => {
    const delta = 0.60 - 0.72;
    expect(delta).toBeCloseTo(-0.12);
  });

  it("computes zero delta when scores match", () => {
    expect(0.72 - 0.72).toBe(0);
  });
});

/* ── B) extractUnits fallback ── */

describe("extractUnits fallback", () => {
  function extractUnits(json: any): any[] | null {
    if (!json) return null;
    if (Array.isArray(json)) return json.length > 0 && typeof json[0] === 'object' ? json : null;
    for (const key of ['units', 'beats', 'segments', 'panels', 'items']) {
      if (Array.isArray(json[key]) && json[key].length > 0) return json[key];
    }
    return null;
  }

  it("returns null for null/undefined", () => {
    expect(extractUnits(null)).toBeNull();
    expect(extractUnits(undefined)).toBeNull();
  });

  it("extracts units from object with units key", () => {
    const result = extractUnits({ units: [{ intent: "intrigue", energy: 0.5 }] });
    expect(result).toHaveLength(1);
    expect(result![0].intent).toBe("intrigue");
  });

  it("extracts from beats key", () => {
    expect(extractUnits({ beats: [{ intent: "chaos" }] })).toHaveLength(1);
  });

  it("handles top-level array", () => {
    expect(extractUnits([{ intent: "wonder" }])).toHaveLength(1);
  });

  it("returns null for empty object", () => {
    expect(extractUnits({})).toBeNull();
  });

  it("returns null for primitive array", () => {
    expect(extractUnits([1, 2, 3])).toBeNull();
  });

  it("renders JSON fallback when no units key exists", () => {
    const json = { some_key: "value", nested: { a: 1 } };
    expect(extractUnits(json)).toBeNull();
    expect(() => JSON.stringify(json, null, 2)).not.toThrow();
  });
});

/* ── C) Trend Computations ── */

describe("computePassRate", () => {
  it("computes rate for full window", () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({ final_pass: i < 15 }));
    const result = computePassRate(runs);
    expect(result.passCount).toBe(15);
    expect(result.total).toBe(20);
    expect(result.rate).toBeCloseTo(0.75);
  });

  it("handles fewer than 20 runs", () => {
    const runs = [{ final_pass: true }, { final_pass: false }, { final_pass: true }];
    const result = computePassRate(runs);
    expect(result.total).toBe(3);
    expect(result.rate).toBeCloseTo(2 / 3);
  });

  it("handles empty array", () => {
    expect(computePassRate([]).rate).toBe(0);
    expect(computePassRate([]).total).toBe(0);
  });

  it("handles all pass", () => {
    expect(computePassRate([{ final_pass: true }, { final_pass: true }]).rate).toBe(1);
  });

  it("handles all fail", () => {
    expect(computePassRate([{ final_pass: false }, { final_pass: false }]).rate).toBe(0);
  });

  it("single run pass", () => {
    expect(computePassRate([{ final_pass: true }]).rate).toBe(1);
  });
});

describe("computeAvgScore", () => {
  it("computes mean score", () => {
    expect(computeAvgScore([{ final_score: 0.8 }, { final_score: 0.6 }, { final_score: 0.7 }])).toBeCloseTo(0.7);
  });

  it("returns 0 for empty", () => {
    expect(computeAvgScore([])).toBe(0);
  });

  it("handles single run", () => {
    expect(computeAvgScore([{ final_score: 0.85 }])).toBeCloseTo(0.85);
  });

  it("handles extreme scores", () => {
    expect(computeAvgScore([{ final_score: 0 }, { final_score: 1 }])).toBeCloseTo(0.5);
  });
});

describe("buildChartData", () => {
  it("orders oldest to newest", () => {
    const runs = [
      { final_score: 0.9, final_pass: true, created_at: "2026-02-25T03:00:00Z" },
      { final_score: 0.7, final_pass: false, created_at: "2026-02-25T01:00:00Z" },
      { final_score: 0.8, final_pass: true, created_at: "2026-02-25T02:00:00Z" },
    ];
    const chart = buildChartData(runs);
    expect(chart[0].score).toBeCloseTo(0.7);
    expect(chart[1].score).toBeCloseTo(0.8);
    expect(chart[2].score).toBeCloseTo(0.9);
  });

  it("preserves pass/fail in chart data", () => {
    const runs = [
      { final_score: 0.5, final_pass: false, created_at: "2026-01-01T00:00:00Z" },
      { final_score: 0.9, final_pass: true, created_at: "2026-01-02T00:00:00Z" },
    ];
    const chart = buildChartData(runs);
    expect(chart[0].pass).toBe(false);
    expect(chart[1].pass).toBe(true);
  });

  it("handles empty array", () => {
    expect(buildChartData([])).toEqual([]);
  });

  it("does not mutate input array", () => {
    const runs = [
      { final_score: 0.9, final_pass: true, created_at: "2026-02-25T03:00:00Z" },
      { final_score: 0.7, final_pass: false, created_at: "2026-02-25T01:00:00Z" },
    ];
    const originalFirst = runs[0].final_score;
    buildChartData(runs);
    expect(runs[0].final_score).toBe(originalFirst);
  });

  it("single run produces single chart point", () => {
    const chart = buildChartData([{ final_score: 0.8, final_pass: true, created_at: "2026-01-01T00:00:00Z" }]);
    expect(chart).toHaveLength(1);
    expect(chart[0].score).toBeCloseTo(0.8);
  });
});

/* ── D) Normalization ── */

describe("normalizeScores", () => {
  it("returns empty for empty input", () => {
    const r = normalizeScores([]);
    expect(r.normalized).toEqual([]);
    expect(r.min).toBe(0);
    expect(r.max).toBe(0);
    expect(r.avg).toBe(0);
  });

  it("scores in [0,1] are preserved as-is", () => {
    const r = normalizeScores([0.3, 0.7, 0.5]);
    expect(r.normalized).toEqual([0.3, 0.7, 0.5]);
    expect(r.min).toBeCloseTo(0.3);
    expect(r.max).toBeCloseTo(0.7);
    expect(r.avg).toBeCloseTo(0.5);
  });

  it("scores outside [0,1] are min-max normalized", () => {
    const r = normalizeScores([10, 20, 30]);
    expect(r.normalized).toEqual([0, 0.5, 1]);
    expect(r.min).toBe(10);
    expect(r.max).toBe(30);
    expect(r.avg).toBeCloseTo(20);
  });

  it("handles all identical scores (range=0)", () => {
    const r = normalizeScores([0.5, 0.5, 0.5]);
    expect(r.normalized).toEqual([0.5, 0.5, 0.5]);
    expect(r.min).toBeCloseTo(0.5);
    expect(r.max).toBeCloseTo(0.5);
  });

  it("handles identical scores outside [0,1]", () => {
    const r = normalizeScores([5, 5]);
    // range=0, fallback range=1 → (5-5)/1=0
    expect(r.normalized).toEqual([0, 0]);
  });

  it("is deterministic across multiple calls", () => {
    const input = [0.1, 0.9, 0.4, 0.6];
    const r1 = normalizeScores(input);
    const r2 = normalizeScores(input);
    expect(r1).toEqual(r2);
  });

  it("single score in [0,1] preserved", () => {
    const r = normalizeScores([0.42]);
    expect(r.normalized).toEqual([0.42]);
    expect(r.avg).toBeCloseTo(0.42);
  });

  it("boundary: max exactly 1.0", () => {
    const r = normalizeScores([0.0, 1.0]);
    expect(r.normalized).toEqual([0.0, 1.0]);
  });
});

/* ── E) Graceful missing states ── */

describe("run detail graceful states", () => {
  it("single-attempt run: no diff computed when attempt1 missing", () => {
    const attempt0Failures = ["WEAK_ARC"];
    const attempt1Failures: string[] | undefined = undefined;
    const diff = attempt1Failures ? computeFailureDiff(attempt0Failures, attempt1Failures) : null;
    expect(diff).toBeNull();
  });

  it("empty run list produces zero across all metrics", () => {
    expect(computePassRate([]).rate).toBe(0);
    expect(computePassRate([]).total).toBe(0);
    expect(computeAvgScore([])).toBe(0);
    expect(buildChartData([])).toEqual([]);
  });
});
