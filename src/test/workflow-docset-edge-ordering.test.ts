/**
 * Drift-Lock + Ordering Tests for contextDocOrdering + doc set resolver tiebreakers.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { reorderByIncludeIds } from "@/lib/contextDocOrdering";
import { getDocSetDocumentIds } from "@/lib/docSetResolver";

/* ── Drift lock ── */

function stripHeader(content: string): string {
  return content.replace(/^\/\*\*[\s\S]*?\*\/\s*\n/, "").trim();
}

describe("Drift-lock: contextDocOrdering src/ ↔ _shared/", () => {
  it("contextDocOrdering — functional code is identical", () => {
    const src = readFileSync(resolve("src/lib/contextDocOrdering.ts"), "utf-8");
    const edge = readFileSync(resolve("supabase/functions/_shared/contextDocOrdering.ts"), "utf-8");
    expect(stripHeader(src)).toBe(stripHeader(edge));
  });
});

/* ── reorderByIncludeIds tests ── */

describe("reorderByIncludeIds", () => {
  it("preserves includeDocumentIds order even when fetch returns unordered", () => {
    const fetched = [
      { id: "c", name: "C" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const result = reorderByIncludeIds(fetched, ["b", "a", "c"]);
    expect(result.map(r => r.id)).toEqual(["b", "a", "c"]);
  });

  it("skips missing IDs without error", () => {
    const fetched = [{ id: "a", name: "A" }, { id: "c", name: "C" }];
    const result = reorderByIncludeIds(fetched, ["b", "a", "c"]);
    expect(result.map(r => r.id)).toEqual(["a", "c"]);
  });

  it("appends extra fetched items sorted by id asc", () => {
    const fetched = [
      { id: "z", name: "Z" },
      { id: "a", name: "A" },
      { id: "m", name: "M" },
    ];
    const result = reorderByIncludeIds(fetched, ["a"]);
    expect(result.map(r => r.id)).toEqual(["a", "m", "z"]);
  });

  it("returns empty for empty inputs", () => {
    expect(reorderByIncludeIds([], ["a"])).toEqual([]);
    expect(reorderByIncludeIds([], [])).toEqual([]);
  });
});

/* ── getDocSetDocumentIds tiebreaker tests ── */

describe("getDocSetDocumentIds tiebreakers", () => {
  it("breaks sort_order ties by created_at then document_id", () => {
    const items = [
      { id: "i3", doc_set_id: "s", document_id: "d-b", sort_order: 1, created_at: "2025-01-02T00:00:00Z" },
      { id: "i1", doc_set_id: "s", document_id: "d-a", sort_order: 1, created_at: "2025-01-01T00:00:00Z" },
      { id: "i2", doc_set_id: "s", document_id: "d-c", sort_order: 0, created_at: "2025-01-03T00:00:00Z" },
    ];
    const result = getDocSetDocumentIds(items);
    // sort_order 0 first, then two with sort_order 1 tiebroken by created_at
    expect(result).toEqual(["d-c", "d-a", "d-b"]);
  });

  it("breaks created_at ties by document_id asc", () => {
    const items = [
      { id: "i2", doc_set_id: "s", document_id: "d-z", sort_order: 0, created_at: "2025-01-01T00:00:00Z" },
      { id: "i1", doc_set_id: "s", document_id: "d-a", sort_order: 0, created_at: "2025-01-01T00:00:00Z" },
    ];
    const result = getDocSetDocumentIds(items);
    expect(result).toEqual(["d-a", "d-z"]);
  });
});
