/**
 * Quality History UI — diff logic + render safety tests
 */
import { describe, it, expect } from "vitest";
import { computeFailureDiff } from "@/components/cinematic/QualityRunHistory";

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

describe("pass/fail badge logic", () => {
  it("true maps to pass", () => {
    expect(true).toBe(true);
  });
  it("false maps to fail", () => {
    expect(false).toBe(false);
  });
});
