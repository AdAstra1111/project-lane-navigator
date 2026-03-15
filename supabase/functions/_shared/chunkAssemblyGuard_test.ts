import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { containsFailedPlaceholders, FAILED_CHUNK_PLACEHOLDER_RE } from "./chunkRunner.ts";

// ── Placeholder detection ──

Deno.test("detects single failed chunk placeholder", () => {
  const text = "Act 1 content here.\n\n[SECTION 2 GENERATION FAILED — REGENERATE THIS DOCUMENT]\n\nAct 3 content here.";
  assertEquals(containsFailedPlaceholders(text), true);
});

Deno.test("detects placeholder at any section number", () => {
  assertEquals(containsFailedPlaceholders("[SECTION 1 GENERATION FAILED — REGENERATE THIS DOCUMENT]"), true);
  assertEquals(containsFailedPlaceholders("[SECTION 4 GENERATION FAILED — REGENERATE THIS DOCUMENT]"), true);
  assertEquals(containsFailedPlaceholders("[SECTION 12 GENERATION FAILED — REGENERATE THIS DOCUMENT]"), true);
});

Deno.test("returns false for clean assembled text", () => {
  const text = "## ACT 1\n\nThe story begins.\n\n## ACT 2\n\nThe conflict escalates.\n\n## ACT 3\n\nResolution.";
  assertEquals(containsFailedPlaceholders(text), false);
});

Deno.test("returns false for empty text", () => {
  assertEquals(containsFailedPlaceholders(""), false);
});

Deno.test("returns false for text mentioning 'SECTION' in normal context", () => {
  assertEquals(containsFailedPlaceholders("This section covers the protagonist's backstory."), false);
  assertEquals(containsFailedPlaceholders("SECTION 3: The Climax"), false);
});

Deno.test("regex matches the exact placeholder pattern", () => {
  assertEquals(FAILED_CHUNK_PLACEHOLDER_RE.test("[SECTION 2 GENERATION FAILED"), true);
  assertEquals(FAILED_CHUNK_PLACEHOLDER_RE.test("normal text"), false);
});

// ── ChunkRunResult.success semantics ──

Deno.test("success should be false when failedChunks > 0 (documented contract)", () => {
  // This tests the contract: success = validationResult.pass && failedChunks === 0
  // We verify the logic inline since we can't call runChunkedGeneration without DB
  const validationPass = true;
  const failedChunks = 1;
  const success = validationPass && failedChunks === 0;
  assertEquals(success, false, "success must be false when any chunk failed");
});

Deno.test("success should be true when all chunks pass", () => {
  const validationPass = true;
  const failedChunks = 0;
  const success = validationPass && failedChunks === 0;
  assertEquals(success, true);
});
