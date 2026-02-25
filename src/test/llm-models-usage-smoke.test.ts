/**
 * LLM MODELS Usage Smoke Test
 *
 * Reads each target edge function source file and asserts no raw
 * "google/gemini-*" or "openai/gpt-*" model string literals remain.
 * All model references should use MODELS.* constants from _shared/llm.ts.
 *
 * Excluded: supabase/functions/_shared/cik/modelRouter.ts (CIK router has
 * its own intentional constants guarded by cik-model-router-drift tests).
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const TARGET_FILES = [
  "supabase/functions/auto-schedule/index.ts",
  "supabase/functions/analyze-project/index.ts",
  "supabase/functions/project-incentive-insights/index.ts",
  "supabase/functions/script-intake/index.ts",
  "supabase/functions/schedule-intelligence/index.ts",
  "supabase/functions/research-person/index.ts",
  "supabase/functions/ai-trailer-factory/index.ts",
  "supabase/functions/analyze-note/index.ts",
  "supabase/functions/research-buyers/index.ts",
  "supabase/functions/embed-corpus/index.ts",
  "supabase/functions/document-assistant-run/index.ts",
  "supabase/functions/analyze-corpus/index.ts",
  "supabase/functions/comp-analysis/index.ts",
  "supabase/functions/doc-assistant/index.ts",
  "supabase/functions/extract-budget/index.ts",
  "supabase/functions/_shared/episodeBeatsChunked.ts",
];

/**
 * Matches raw model string literals like "google/gemini-2.5-flash" or "openai/gpt-5".
 * Excludes occurrences inside comments (lines starting with // or *).
 */
function findRawModelLiterals(source: string): string[] {
  const hits: string[] = [];
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    // Skip comment lines
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    // Match quoted model strings
    const matches = line.match(/"(google\/gemini[^"]+|openai\/gpt[^"]+)"/g);
    if (matches) hits.push(...matches);
  }
  return hits;
}

describe("LLM MODELS usage smoke: no raw model literals in edge functions", () => {
  for (const filePath of TARGET_FILES) {
    it(`${filePath} has no hardcoded model strings`, () => {
      const fullPath = path.resolve(filePath);
      const source = fs.readFileSync(fullPath, "utf-8");
      const hits = findRawModelLiterals(source);
      expect(hits, `Found raw model literals in ${filePath}: ${hits.join(", ")}`).toEqual([]);
    });
  }

  it("_shared/llm.ts MODELS block is the canonical source (contains all expected constants)", () => {
    const llmPath = path.resolve("supabase/functions/_shared/llm.ts");
    const source = fs.readFileSync(llmPath, "utf-8");
    // These constants must exist in the MODELS block
    expect(source).toContain("FAST:");
    expect(source).toContain("FAST_LITE:");
    expect(source).toContain("BALANCED:");
    expect(source).toContain("PRO:");
    expect(source).toContain("FLASH_IMAGE:");
  });
});
