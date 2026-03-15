import { assertEquals, assertMatch } from "https://deno.land/std@0.168.0/testing/asserts.ts";

/**
 * Regression tests for canon-alignment gate error handling in doc-os.ts
 *
 * Tests the error classification logic inline (mirrored from doc-os.ts catch block)
 * to ensure:
 *  1. CANON_MISMATCH errors are re-thrown as-is
 *  2. Unexpected gate errors (DB, network) are re-thrown as CANON_GATE_ERROR
 *  3. Neither class is silently skipped
 */

function classifyCanonGateError(err: Error): { action: "rethrow_mismatch" | "rethrow_gate_error"; message: string } {
  if (err?.message?.startsWith("CANON_MISMATCH:")) {
    return { action: "rethrow_mismatch", message: err.message };
  }
  const gateErr = `CANON_GATE_ERROR: doc_type="test_doc" generator="test-gen" error="${err?.message}"`;
  return { action: "rethrow_gate_error", message: gateErr };
}

// ── CANON_MISMATCH errors are preserved ──

Deno.test("CANON_MISMATCH errors are classified as rethrow_mismatch", () => {
  const err = new Error('CANON_MISMATCH: doc_type="screenplay" coverage=0.3');
  const result = classifyCanonGateError(err);
  assertEquals(result.action, "rethrow_mismatch");
  assertMatch(result.message, /^CANON_MISMATCH:/);
});

// ── DB / infrastructure errors fail closed ──

Deno.test("DB connection error becomes CANON_GATE_ERROR", () => {
  const err = new Error("connection refused");
  const result = classifyCanonGateError(err);
  assertEquals(result.action, "rethrow_gate_error");
  assertMatch(result.message, /^CANON_GATE_ERROR:/);
  assertMatch(result.message, /connection refused/);
});

Deno.test("Postgres error becomes CANON_GATE_ERROR", () => {
  const err = new Error("relation \"project_documents\" does not exist");
  const result = classifyCanonGateError(err);
  assertEquals(result.action, "rethrow_gate_error");
  assertMatch(result.message, /^CANON_GATE_ERROR:/);
});

Deno.test("Generic TypeError becomes CANON_GATE_ERROR", () => {
  const err = new TypeError("Cannot read properties of undefined (reading 'entities')");
  const result = classifyCanonGateError(err);
  assertEquals(result.action, "rethrow_gate_error");
  assertMatch(result.message, /CANON_GATE_ERROR/);
});

Deno.test("Network timeout becomes CANON_GATE_ERROR", () => {
  const err = new Error("request timed out");
  const result = classifyCanonGateError(err);
  assertEquals(result.action, "rethrow_gate_error");
});

Deno.test("Null/undefined error still produces CANON_GATE_ERROR", () => {
  const err = new Error(undefined as any);
  const result = classifyCanonGateError(err);
  assertEquals(result.action, "rethrow_gate_error");
  assertMatch(result.message, /CANON_GATE_ERROR/);
});

// ── Gate error message includes context ──

Deno.test("CANON_GATE_ERROR message includes doc_type and generator", () => {
  const err = new Error("some DB failure");
  const result = classifyCanonGateError(err);
  assertMatch(result.message, /doc_type="test_doc"/);
  assertMatch(result.message, /generator="test-gen"/);
});
