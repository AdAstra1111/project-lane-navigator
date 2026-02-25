/**
 * Unit tests for trailer clip attempt retry policy + best selection determinism.
 */
import { describe, it, expect } from "vitest";
import {
  shouldRetry,
  selectBestAttempt,
  normalizePrompt,
  MAX_ATTEMPTS,
  PASS_THRESHOLD,
  FAILURE_ESCALATE_SET,
  nextAttemptPlan,
  type AttemptRecord,
} from "../../supabase/functions/_shared/trailerPipeline/attemptPolicy";

// ─── shouldRetry ───

describe("shouldRetry", () => {
  it("no retry when score >= threshold", () => {
    expect(shouldRetry({ evalScore: 0.80, failures: [], attemptIndex: 0 })).toBe(false);
  });

  it("retry when score < threshold and under max", () => {
    expect(shouldRetry({ evalScore: 0.5, failures: [], attemptIndex: 0 })).toBe(true);
  });

  it("retry when failures include ENERGY_DROP even if score passes", () => {
    expect(shouldRetry({ evalScore: 0.85, failures: ["ENERGY_DROP"], attemptIndex: 0 })).toBe(true);
  });

  it("no retry when at max attempts", () => {
    expect(shouldRetry({ evalScore: 0.3, failures: [], attemptIndex: MAX_ATTEMPTS - 1 })).toBe(false);
  });

  it("no retry when evalScore is null (no eval)", () => {
    expect(shouldRetry({ evalScore: null, failures: [], attemptIndex: 0 })).toBe(false);
  });

  it("retry on each known failure keyword", () => {
    for (const f of FAILURE_ESCALATE_SET) {
      expect(shouldRetry({ evalScore: 0.90, failures: [f], attemptIndex: 0 })).toBe(true);
    }
  });

  it("no retry on unknown failure with passing score", () => {
    expect(shouldRetry({ evalScore: 0.80, failures: ["UNKNOWN_ISSUE"], attemptIndex: 0 })).toBe(false);
  });
});

// ─── selectBestAttempt ───

describe("selectBestAttempt", () => {
  const base: AttemptRecord = {
    id: "a1",
    attempt_index: 0,
    eval_score: 0.8,
    completed_at: "2026-01-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    status: "complete",
  };

  it("picks highest score", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", eval_score: 0.6 },
      { ...base, id: "a2", eval_score: 0.9, attempt_index: 1 },
    ];
    expect(selectBestAttempt(attempts)?.id).toBe("a2");
  });

  it("tie-breaks by completed_at (earlier wins)", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", eval_score: 0.8, completed_at: "2026-01-02T00:00:00Z" },
      { ...base, id: "a2", eval_score: 0.8, completed_at: "2026-01-01T00:00:00Z", attempt_index: 1 },
    ];
    expect(selectBestAttempt(attempts)?.id).toBe("a2");
  });

  it("tie-breaks by created_at when completed_at matches", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", eval_score: 0.8, created_at: "2026-01-02T00:00:00Z" },
      { ...base, id: "a2", eval_score: 0.8, created_at: "2026-01-01T00:00:00Z", attempt_index: 1 },
    ];
    expect(selectBestAttempt(attempts)?.id).toBe("a2");
  });

  it("tie-breaks by attempt_index (lower wins)", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", eval_score: 0.8, attempt_index: 1 },
      { ...base, id: "a2", eval_score: 0.8, attempt_index: 0 },
    ];
    expect(selectBestAttempt(attempts)?.id).toBe("a2");
  });

  it("returns null for empty list", () => {
    expect(selectBestAttempt([])).toBeNull();
  });

  it("returns null when no complete attempts", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", status: "queued" },
    ];
    expect(selectBestAttempt(attempts)).toBeNull();
  });

  it("falls back to completed without score if no scored attempts exist", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", eval_score: null },
      { ...base, id: "a2", eval_score: null, attempt_index: 1 },
    ];
    // Both have null score, should pick by completed_at / created_at / index
    const best = selectBestAttempt(attempts);
    expect(best).not.toBeNull();
    expect(best?.id).toBe("a1"); // lower index wins
  });

  it("determinism: same input always same output", () => {
    const attempts: AttemptRecord[] = [
      { ...base, id: "a1", eval_score: 0.7, attempt_index: 0 },
      { ...base, id: "a2", eval_score: 0.7, attempt_index: 1, completed_at: "2026-01-01T00:00:01Z" },
      { ...base, id: "a3", eval_score: 0.7, attempt_index: 2, completed_at: "2026-01-01T00:00:02Z" },
    ];
    const r1 = selectBestAttempt(attempts);
    const r2 = selectBestAttempt([...attempts].reverse());
    expect(r1?.id).toBe(r2?.id);
  });
});

// ─── normalizePrompt ───

describe("normalizePrompt", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizePrompt("  Hello   World\n\tTest  ")).toBe("hello world test");
  });
});

// ─── nextAttemptPlan ───

describe("nextAttemptPlan", () => {
  it("attempt 1 uses BALANCED", () => {
    const plan = nextAttemptPlan(0, "base prompt", {});
    expect(plan.attemptIndex).toBe(1);
    expect(plan.model).toBe("BALANCED");
    expect(plan.promptSuffix.length).toBeGreaterThan(0);
  });

  it("attempt 2 uses PRO", () => {
    const plan = nextAttemptPlan(1, "base prompt", {});
    expect(plan.attemptIndex).toBe(2);
    expect(plan.model).toBe("PRO");
  });
});

// ─── Constants sanity ───

describe("constants", () => {
  it("MAX_ATTEMPTS is 3", () => expect(MAX_ATTEMPTS).toBe(3));
  it("PASS_THRESHOLD is 0.75", () => expect(PASS_THRESHOLD).toBe(0.75));
  it("FAILURE_ESCALATE_SET has 6 entries", () => expect(FAILURE_ESCALATE_SET.size).toBe(6));
});
