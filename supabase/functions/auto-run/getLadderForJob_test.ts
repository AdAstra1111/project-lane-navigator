import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * Regression tests for getLadderForJob fail-closed behaviour.
 *
 * These tests import the canonical stage-ladders.json and replicate
 * the exact lookup logic from getLadderForJob to ensure:
 * 1. All valid formats resolve to their correct ladder
 * 2. Unknown formats return null (fail-closed, no film fallback)
 * 3. No silent fallback to any ladder for unrecognized input
 */

// Import canonical registry (same import used by auto-run/index.ts)
import stageLadders from "../_shared/stage-ladders.json" with { type: "json" };
const FORMAT_LADDERS: Record<string, string[]> = stageLadders.FORMAT_LADDERS;
const DOC_TYPE_ALIASES: Record<string, string> = stageLadders.DOC_TYPE_ALIASES;

// Mirror of getLadderForJob from auto-run/index.ts (fail-closed version)
function getLadderForJob(format: string): string[] | null {
  const key = (format || "").toLowerCase().replace(/_/g, "-");
  if (FORMAT_LADDERS[key]) return FORMAT_LADDERS[key];
  const aliased = DOC_TYPE_ALIASES[key];
  if (aliased && FORMAT_LADDERS[aliased]) return FORMAT_LADDERS[aliased];
  return null;
}

// ── Valid format resolution ──

Deno.test("film resolves to film ladder", () => {
  const ladder = getLadderForJob("film");
  assertEquals(ladder, FORMAT_LADDERS["film"]);
});

Deno.test("tv-series resolves to tv-series ladder", () => {
  const ladder = getLadderForJob("tv-series");
  assertEquals(ladder, FORMAT_LADDERS["tv-series"]);
});

Deno.test("vertical-drama resolves to vertical-drama ladder", () => {
  const ladder = getLadderForJob("vertical-drama");
  assertEquals(ladder, FORMAT_LADDERS["vertical-drama"]);
});

Deno.test("documentary resolves to documentary ladder", () => {
  const ladder = getLadderForJob("documentary");
  assertEquals(ladder, FORMAT_LADDERS["documentary"]);
});

Deno.test("short resolves to short ladder", () => {
  const ladder = getLadderForJob("short");
  assertEquals(ladder, FORMAT_LADDERS["short"]);
});

Deno.test("animation resolves to animation ladder", () => {
  const ladder = getLadderForJob("animation");
  assertEquals(ladder, FORMAT_LADDERS["animation"]);
});

Deno.test("reality resolves to reality ladder", () => {
  const ladder = getLadderForJob("reality");
  assertEquals(ladder, FORMAT_LADDERS["reality"]);
});

Deno.test("all FORMAT_LADDERS keys resolve to themselves", () => {
  for (const key of Object.keys(FORMAT_LADDERS)) {
    const ladder = getLadderForJob(key);
    assertEquals(ladder, FORMAT_LADDERS[key], `Format "${key}" should resolve to its own ladder`);
  }
});

// ── Normalization ──

Deno.test("underscore format normalizes correctly (tv_series → tv-series)", () => {
  const ladder = getLadderForJob("tv_series");
  assertEquals(ladder, FORMAT_LADDERS["tv-series"]);
});

Deno.test("uppercase format normalizes correctly (FILM → film)", () => {
  const ladder = getLadderForJob("FILM");
  assertEquals(ladder, FORMAT_LADDERS["film"]);
});

// ── FAIL-CLOSED: unknown formats must NOT resolve ──

Deno.test("unknown format returns null (fail-closed)", () => {
  const ladder = getLadderForJob("made-up-format");
  assertEquals(ladder, null);
});

Deno.test("empty string returns null (fail-closed)", () => {
  const ladder = getLadderForJob("");
  assertEquals(ladder, null);
});

Deno.test("unknown format does NOT fall back to film ladder", () => {
  const filmLadder = FORMAT_LADDERS["film"];
  const unknown = getLadderForJob("unknown-format-xyz");
  assertNotEquals(unknown, filmLadder, "Unknown format must NOT silently resolve to film ladder");
  assertEquals(unknown, null);
});

Deno.test("gibberish format does NOT fall back to film ladder", () => {
  const result = getLadderForJob("asdfghjkl");
  assertEquals(result, null, "Gibberish format must return null, not a default ladder");
});
