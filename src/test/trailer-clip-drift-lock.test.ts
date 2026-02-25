/**
 * Drift-Lock Test — Ensures frontend and edge function shared helpers stay identical.
 * If any of these tests fail, it means someone edited one copy without updating the other.
 * Fix: make the files identical again (only the doc comment header may differ).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/** Strip the first JSDoc comment block (lines 1-4 differ by design) and compare the rest. */
function stripHeader(content: string): string {
  // Remove the first /** ... */ block
  return content.replace(/^\/\*\*[\s\S]*?\*\/\s*\n/, "").trim();
}

const PAIRS = [
  {
    name: "clipJobRecovery",
    src: "src/lib/trailerPipeline/clipJobRecovery.ts",
    edge: "supabase/functions/_shared/trailerPipeline/clipJobRecovery.ts",
  },
  {
    name: "clipEnqueue",
    src: "src/lib/trailerPipeline/clipEnqueue.ts",
    edge: "supabase/functions/_shared/trailerPipeline/clipEnqueue.ts",
  },
  {
    name: "clipSorting",
    src: "src/lib/trailerPipeline/clipSorting.ts",
    edge: "supabase/functions/_shared/trailerPipeline/clipSorting.ts",
  },
  {
    name: "clipDownload",
    src: "src/lib/trailerPipeline/clipDownload.ts",
    edge: "supabase/functions/_shared/trailerPipeline/clipDownload.ts",
  },
];

describe("Drift-lock: src/ ↔ supabase/_shared/ trailer pipeline helpers", () => {
  for (const { name, src, edge } of PAIRS) {
    it(`${name} — functional code is identical between frontend and edge function`, () => {
      const srcContent = readFileSync(resolve(src), "utf-8");
      const edgeContent = readFileSync(resolve(edge), "utf-8");
      const srcBody = stripHeader(srcContent);
      const edgeBody = stripHeader(edgeContent);
      expect(srcBody).toBe(edgeBody);
    });
  }
});
