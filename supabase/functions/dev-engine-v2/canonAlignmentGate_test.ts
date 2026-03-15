import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { shouldRunCanonAlignment } from "../_shared/doc-os.ts";

Deno.test("should skip canon alignment for chunked production_draft rewrites", () => {
  const result = shouldRunCanonAlignment("film", "production_draft", "dev-engine-v2-rewrite-chunked");
  assertEquals(result, false);
});

Deno.test("should still run canon alignment for non-chunked production_draft writes", () => {
  const result = shouldRunCanonAlignment("film", "production_draft", "dev-engine-v2-rewrite");
  assertEquals(result, true);
});

Deno.test("should still run canon alignment for feature scripts in film lane", () => {
  const result = shouldRunCanonAlignment("film", "feature_script", "generate-document");
  assertEquals(result, true);
});
