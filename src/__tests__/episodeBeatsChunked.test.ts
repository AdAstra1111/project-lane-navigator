/**
 * Tests for episodeBeatsChunked — verifies completeness, ordering, and repair.
 */
import { describe, it, expect } from "vitest";
import {
  parseEpisodeBlocks,
  mergeByEpisodeNumber,
  findMissing,
} from "./episodeBeatsChunkedTestHelpers";

// ── parseEpisodeBlocks ──

describe("parseEpisodeBlocks", () => {
  it("parses standard ## EPISODE N headers", () => {
    const raw = `## EPISODE 1
Hook: Something happens
Beat 1: ...

## EPISODE 2
Hook: Another thing
Beat 1: ...`;

    const blocks = parseEpisodeBlocks(raw);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].episodeNumber).toBe(1);
    expect(blocks[1].episodeNumber).toBe(2);
    expect(blocks[0].text).toContain("Something happens");
  });

  it("handles EP shorthand and # heading levels", () => {
    const raw = `# EP 10
Beats here

### Episode 20
More beats`;

    const blocks = parseEpisodeBlocks(raw);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].episodeNumber).toBe(10);
    expect(blocks[1].episodeNumber).toBe(20);
  });

  it("returns empty for no episode headers", () => {
    expect(parseEpisodeBlocks("Just some text without episodes")).toHaveLength(0);
  });
});

// ── mergeByEpisodeNumber ──

describe("mergeByEpisodeNumber", () => {
  it("merges two sets with numeric sorting (not lexical)", () => {
    const a = [
      { episodeNumber: 1, text: "ep1" },
      { episodeNumber: 10, text: "ep10" },
      { episodeNumber: 2, text: "ep2" },
    ];
    const b = [
      { episodeNumber: 3, text: "ep3" },
      { episodeNumber: 20, text: "ep20" },
    ];

    const merged = mergeByEpisodeNumber(a, b);
    expect(merged.map(m => m.episodeNumber)).toEqual([1, 2, 3, 10, 20]);
  });

  it("proves lexical sort would fail (numeric sort passes)", () => {
    const blocks = [
      { episodeNumber: 1, text: "ep1" },
      { episodeNumber: 2, text: "ep2" },
      { episodeNumber: 10, text: "ep10" },
      { episodeNumber: 11, text: "ep11" },
      { episodeNumber: 9, text: "ep9" },
    ];

    const merged = mergeByEpisodeNumber(blocks, []);
    const order = merged.map(m => m.episodeNumber);
    // Lexical would give: [1, 10, 11, 2, 9] — wrong!
    expect(order).toEqual([1, 2, 9, 10, 11]);
  });

  it("last-wins on duplicate episode numbers", () => {
    const a = [{ episodeNumber: 5, text: "old" }];
    const b = [{ episodeNumber: 5, text: "new" }];
    const merged = mergeByEpisodeNumber(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("new");
  });
});

// ── findMissing ──

describe("findMissing", () => {
  it("detects no missing when complete", () => {
    const blocks = Array.from({ length: 30 }, (_, i) => ({
      episodeNumber: i + 1,
      text: `ep${i + 1}`,
    }));
    expect(findMissing(blocks, 30)).toEqual([]);
  });

  it("detects gap in middle (episodes 20-29 missing)", () => {
    const blocks = [
      ...Array.from({ length: 19 }, (_, i) => ({ episodeNumber: i + 1, text: `ep${i + 1}` })),
      { episodeNumber: 30, text: "ep30" },
    ];
    const missing = findMissing(blocks, 30);
    expect(missing).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it("detects missing at end", () => {
    const blocks = Array.from({ length: 5 }, (_, i) => ({
      episodeNumber: i + 1,
      text: `ep${i + 1}`,
    }));
    const missing = findMissing(blocks, 8);
    expect(missing).toEqual([6, 7, 8]);
  });

  it("works for small N", () => {
    const blocks = [{ episodeNumber: 1, text: "ep1" }];
    expect(findMissing(blocks, 1)).toEqual([]);
    expect(findMissing(blocks, 3)).toEqual([2, 3]);
  });
});

// ── Integration: repair simulation ──

describe("repair simulation", () => {
  it("merge after repair yields complete 1..N", () => {
    // Simulate batch 1 (1-19) + batch 2 (30 only, missing 20-29)
    const batch1 = Array.from({ length: 19 }, (_, i) => ({
      episodeNumber: i + 1,
      text: `ep${i + 1}`,
    }));
    const batch2 = [{ episodeNumber: 30, text: "ep30" }];

    let allBlocks = mergeByEpisodeNumber(batch1, batch2);
    const missing = findMissing(allBlocks, 30);
    expect(missing).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);

    // Simulate repair generating the missing episodes
    const repairBlocks = missing.map(n => ({
      episodeNumber: n,
      text: `ep${n} (repaired)`,
    }));
    allBlocks = mergeByEpisodeNumber(allBlocks, repairBlocks);

    expect(findMissing(allBlocks, 30)).toEqual([]);
    expect(allBlocks).toHaveLength(30);
    expect(allBlocks.map(b => b.episodeNumber)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1)
    );
  });
});
