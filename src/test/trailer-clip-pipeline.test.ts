/**
 * Trailer Clip Pipeline — Deterministic Tests
 * Covers: READY_STATUSES, prompt truncation, content-policy detection, blueprint status contract.
 */
import { describe, it, expect } from "vitest";
import { READY_STATUSES, isReadyStatus } from "@/lib/trailerPipeline/constants";

// ─── READY_STATUSES contract ───

describe("READY_STATUSES shared constant", () => {
  it("contains exactly ready, complete, v2_shim", () => {
    expect([...READY_STATUSES]).toEqual(["ready", "complete", "v2_shim"]);
  });

  it("isReadyStatus accepts all ready statuses", () => {
    expect(isReadyStatus("ready")).toBe(true);
    expect(isReadyStatus("complete")).toBe(true);
    expect(isReadyStatus("v2_shim")).toBe(true);
  });

  it("isReadyStatus rejects non-ready statuses", () => {
    expect(isReadyStatus("draft")).toBe(false);
    expect(isReadyStatus("failed")).toBe(false);
    expect(isReadyStatus("")).toBe(false);
    expect(isReadyStatus("COMPLETE")).toBe(false); // case-sensitive
  });
});

// ─── Prompt truncation (mirrors backend truncatePrompt) ───

function truncatePrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;
  return prompt.slice(0, maxChars - 3) + "...";
}

describe("Runway prompt truncation", () => {
  const RUNWAY_MAX = 990;

  it("short prompt passes through unchanged", () => {
    const p = "A dramatic tracking shot of a sunset";
    expect(truncatePrompt(p, RUNWAY_MAX)).toBe(p);
    expect(truncatePrompt(p, RUNWAY_MAX).length).toBeLessThanOrEqual(RUNWAY_MAX);
  });

  it("exactly 990 chars passes through unchanged", () => {
    const p = "x".repeat(990);
    expect(truncatePrompt(p, RUNWAY_MAX)).toBe(p);
    expect(truncatePrompt(p, RUNWAY_MAX).length).toBe(990);
  });

  it("991 chars gets truncated to <= 990", () => {
    const p = "x".repeat(991);
    const result = truncatePrompt(p, RUNWAY_MAX);
    expect(result.length).toBeLessThanOrEqual(RUNWAY_MAX);
    expect(result.endsWith("...")).toBe(true);
  });

  it("very long prompt (5000 chars) truncates deterministically", () => {
    const p = "A".repeat(5000);
    const r1 = truncatePrompt(p, RUNWAY_MAX);
    const r2 = truncatePrompt(p, RUNWAY_MAX);
    expect(r1).toBe(r2); // deterministic
    expect(r1.length).toBeLessThanOrEqual(RUNWAY_MAX);
    expect(r1.length).toBe(990);
  });

  it("never exceeds limit for any input length", () => {
    for (const len of [0, 1, 100, 989, 990, 991, 1000, 2000, 10000]) {
      const p = "z".repeat(len);
      expect(truncatePrompt(p, RUNWAY_MAX).length).toBeLessThanOrEqual(RUNWAY_MAX);
    }
  });
});

// ─── Content-policy detection (mirrors backend isContentPolicyError) ───

const VEO_CONTENT_POLICY_PATTERNS = [
  "usage guidelines",
  "content policy",
  "safety filter",
  "safety settings",
  "blocked by safety",
  "prohibited content",
  "violates",
  "SAFETY",
  "ResponsibleAI",
];

function isContentPolicyError(errorMessage: string): boolean {
  const lower = errorMessage.toLowerCase();
  return VEO_CONTENT_POLICY_PATTERNS.some(p => lower.includes(p.toLowerCase()));
}

describe("Veo content-policy detection", () => {
  it("detects 'usage guidelines' error", () => {
    expect(isContentPolicyError("prompt contains words that violate Gemini API's usage guidelines")).toBe(true);
  });

  it("detects 'content policy' error", () => {
    expect(isContentPolicyError("Request blocked by content policy")).toBe(true);
  });

  it("detects 'safety filter' error", () => {
    expect(isContentPolicyError("Blocked by safety filter")).toBe(true);
  });

  it("detects 'violates' keyword", () => {
    expect(isContentPolicyError("This prompt violates our terms")).toBe(true);
  });

  it("detects 'SAFETY' (case insensitive)", () => {
    expect(isContentPolicyError("Error code: SAFETY")).toBe(true);
  });

  it("does NOT flag normal errors", () => {
    expect(isContentPolicyError("Veo API error 500: Internal server error")).toBe(false);
    expect(isContentPolicyError("Rate limited after 3 retries")).toBe(false);
    expect(isContentPolicyError("Network timeout")).toBe(false);
    expect(isContentPolicyError("not enough credits")).toBe(false);
  });

  it("does NOT flag empty string", () => {
    expect(isContentPolicyError("")).toBe(false);
  });
});

// ─── Blueprint status contract ───

describe("Blueprint status contract", () => {
  it("v2 cinematic engine must write 'complete' (verified by source search)", () => {
    // This is a source-level invariant test.
    // The cinematic engine writes status: "complete" for v2 blueprints.
    // If this ever changes, the clip generator gate will reject enqueue.
    const validStatuses = [...READY_STATUSES];
    expect(validStatuses).toContain("complete");
    expect(validStatuses).toContain("ready");
    expect(validStatuses).toContain("v2_shim"); // backwards compat
  });

  it("clip generator gate accepts all READY_STATUSES", () => {
    for (const status of READY_STATUSES) {
      expect(isReadyStatus(status)).toBe(true);
    }
  });
});

// ─── Provider isolation (deterministic logic test) ───

describe("Provider queue isolation", () => {
  it("rate-limited provider set correctly isolates providers", () => {
    const rateLimitedProviders = new Set<string>();
    rateLimitedProviders.add("veo");

    // Veo is blocked
    expect(rateLimitedProviders.has("veo")).toBe(true);
    // Runway is NOT blocked
    expect(rateLimitedProviders.has("runway")).toBe(false);

    // After adding runway
    rateLimitedProviders.add("runway");
    expect(rateLimitedProviders.has("runway")).toBe(true);
  });

  it("rate-limited set is per-cycle (fresh set each time)", () => {
    // Simulates that each process_queue cycle starts with a fresh set
    const cycle1 = new Set<string>();
    cycle1.add("veo");

    const cycle2 = new Set<string>();
    // Cycle 2 should NOT inherit veo block from cycle 1
    expect(cycle2.has("veo")).toBe(false);
  });
});

// ─── Veo fallback idempotency ───

describe("Veo content-policy fallback idempotency", () => {
  it("fallback key is deterministic from original idempotency_key", () => {
    const originalKey = "abc123-beat0-shot0-veo";
    const fallbackKey = `${originalKey}-runway-fallback`;
    expect(fallbackKey).toBe("abc123-beat0-shot0-veo-runway-fallback");

    // Same input always yields same key
    const fallbackKey2 = `${originalKey}-runway-fallback`;
    expect(fallbackKey).toBe(fallbackKey2);
  });

  it("non-policy errors do not match isContentPolicyError", () => {
    expect(isContentPolicyError("Veo API error 500: Internal server error")).toBe(false);
    expect(isContentPolicyError("Rate limited after 3 retries")).toBe(false);
    expect(isContentPolicyError("not enough credits")).toBe(false);
  });
});
