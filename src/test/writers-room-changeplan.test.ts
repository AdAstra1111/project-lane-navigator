import { describe, it, expect } from "vitest";
import {
  validateChangePlan,
  planHasExplicitDeletions,
  computeDiffSummary,
  SHRINK_GUARD_THRESHOLD,
  type ChangePlan,
  type ChangePlanChange,
} from "@/lib/types/writers-room";

const makeChange = (overrides: Partial<ChangePlanChange> = {}): ChangePlanChange => ({
  id: "chg_1",
  title: "Test change",
  type: "dialogue",
  scope: "scene",
  target: { scene_numbers: [3, 5] },
  instructions: "Rewrite dialogue for clarity",
  rationale: "Too wordy",
  enabled: true,
  ...overrides,
});

const makePlan = (overrides: Partial<ChangePlan> = {}): ChangePlan => ({
  id: "plan_1",
  thread_id: "t_1",
  created_at: "2026-01-01",
  status: "draft",
  direction_summary: "Tighten dialogue in act 2",
  changes: [makeChange()],
  impacts: [],
  rewrite_payload: { mode: "selective", target_scene_numbers: [3, 5], patch_strategy: "surgical", prompt: "..." },
  verification: ["Check scene 3 dialogue length decreased"],
  rollback_supported: true,
  ...overrides,
});

describe("validateChangePlan", () => {
  it("returns no errors for valid plan", () => {
    expect(validateChangePlan(makePlan())).toEqual([]);
  });

  it("flags missing direction_summary", () => {
    const errors = validateChangePlan(makePlan({ direction_summary: "" }));
    expect(errors).toContain("Missing direction_summary");
  });

  it("flags empty changes", () => {
    const errors = validateChangePlan(makePlan({ changes: [] }));
    expect(errors.some(e => e.includes("No changes"))).toBe(true);
  });

  it("flags change missing id", () => {
    const errors = validateChangePlan(makePlan({ changes: [makeChange({ id: "" })] }));
    expect(errors.some(e => e.includes("missing id"))).toBe(true);
  });

  it("flags change missing type", () => {
    const errors = validateChangePlan(makePlan({ changes: [makeChange({ type: "" as any })] }));
    expect(errors.some(e => e.includes("missing type"))).toBe(true);
  });

  it("flags change missing instructions", () => {
    const errors = validateChangePlan(makePlan({ changes: [makeChange({ instructions: "" })] }));
    expect(errors.some(e => e.includes("missing instructions"))).toBe(true);
  });
});

describe("planHasExplicitDeletions", () => {
  it("returns false for non-deletion plans", () => {
    expect(planHasExplicitDeletions(makePlan())).toBe(false);
  });

  it("detects 'delete' in structure change", () => {
    const plan = makePlan({
      changes: [makeChange({ type: "structure", instructions: "Delete scene 7 entirely" })],
    });
    expect(planHasExplicitDeletions(plan)).toBe(true);
  });

  it("detects 'remove scene' in instructions", () => {
    const plan = makePlan({
      changes: [makeChange({ instructions: "Remove scene 4 and merge with 5" })],
    });
    expect(planHasExplicitDeletions(plan)).toBe(true);
  });

  it("detects 'cut scene' in instructions", () => {
    const plan = makePlan({
      changes: [makeChange({ instructions: "Cut scene 12 for pacing" })],
    });
    expect(planHasExplicitDeletions(plan)).toBe(true);
  });
});

describe("computeDiffSummary", () => {
  it("computes positive delta correctly", () => {
    const before = "Hello world";
    const after = "Hello beautiful world, how are you?";
    const diff = computeDiffSummary(before, after, [makeChange()]);
    expect(diff.before_length).toBe(before.length);
    expect(diff.after_length).toBe(after.length);
    expect(diff.length_delta).toBe(after.length - before.length);
    expect(diff.length_delta_pct).toBeGreaterThan(0);
    expect(diff.changes_applied).toBe(1);
  });

  it("computes negative delta correctly", () => {
    const before = "This is a very long piece of text with lots of content";
    const after = "Short text";
    const diff = computeDiffSummary(before, after, []);
    expect(diff.length_delta).toBeLessThan(0);
    expect(diff.length_delta_pct).toBeLessThan(0);
  });

  it("collects affected scenes from changes", () => {
    const changes = [
      makeChange({ target: { scene_numbers: [3, 5] } }),
      makeChange({ target: { scene_numbers: [5, 8] } }),
    ];
    const diff = computeDiffSummary("a", "b", changes);
    expect(diff.affected_scenes).toEqual([3, 5, 8]); // sorted, deduplicated
    expect(diff.affected_scene_count).toBe(3);
  });

  it("handles empty before text", () => {
    const diff = computeDiffSummary("", "new text", []);
    expect(diff.length_delta_pct).toBe(0); // division by zero guarded
  });

  it("is deterministic", () => {
    const a = computeDiffSummary("abc", "abcdef", [makeChange()]);
    const b = computeDiffSummary("abc", "abcdef", [makeChange()]);
    expect(a).toEqual(b);
  });
});

describe("SHRINK_GUARD_THRESHOLD", () => {
  it("is 0.3 (30%)", () => {
    expect(SHRINK_GUARD_THRESHOLD).toBe(0.3);
  });

  it("guards against unsafe shrinks", () => {
    const before = "x".repeat(1000);
    const after = "x".repeat(600); // 40% shrink
    const diff = computeDiffSummary(before, after, []);
    const shrinkFraction = Math.abs(diff.length_delta) / diff.before_length;
    expect(shrinkFraction).toBeGreaterThan(SHRINK_GUARD_THRESHOLD);
  });

  it("allows small shrinks", () => {
    const before = "x".repeat(1000);
    const after = "x".repeat(800); // 20% shrink
    const diff = computeDiffSummary(before, after, []);
    const shrinkFraction = Math.abs(diff.length_delta) / diff.before_length;
    expect(shrinkFraction).toBeLessThan(SHRINK_GUARD_THRESHOLD);
  });
});
