/**
 * Quality History UI — diff logic + render safety tests
 */
import { describe, it, expect } from "vitest";
import { computeFailureDiff, computePassRate, computeAvgScore, buildChartData } from "@/components/cinematic/QualityRunHistory";

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
});

describe("extractUnits fallback", () => {
  // Test the logic inline since extractUnits is not exported
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
    const result = extractUnits({ beats: [{ intent: "chaos" }] });
    expect(result).toHaveLength(1);
  });

  it("handles top-level array", () => {
    const result = extractUnits([{ intent: "wonder" }]);
    expect(result).toHaveLength(1);
  });

  it("returns null for empty object", () => {
    expect(extractUnits({})).toBeNull();
  });

  it("returns null for primitive array", () => {
    expect(extractUnits([1, 2, 3])).toBeNull();
  });
});

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
  });

  it("handles all pass", () => {
    const runs = [{ final_pass: true }, { final_pass: true }];
    expect(computePassRate(runs).rate).toBe(1);
  });

  it("handles all fail", () => {
    const runs = [{ final_pass: false }, { final_pass: false }];
    expect(computePassRate(runs).rate).toBe(0);
  });
});

describe("computeAvgScore", () => {
  it("computes mean score", () => {
    const runs = [{ final_score: 0.8 }, { final_score: 0.6 }, { final_score: 0.7 }];
    expect(computeAvgScore(runs)).toBeCloseTo(0.7);
  });

  it("returns 0 for empty", () => {
    expect(computeAvgScore([])).toBe(0);
  });

  it("handles single run", () => {
    expect(computeAvgScore([{ final_score: 0.85 }])).toBeCloseTo(0.85);
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
});
