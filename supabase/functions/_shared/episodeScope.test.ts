/**
 * Unit tests for episodeScope — episode block parsing, merging, validation, and collapse detection.
 */

import { assertEquals, assertArrayIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  parseEpisodeBlocks,
  mergeEpisodeBlocks,
  validateEpisodeMerge,
  extractTargetEpisodes,
  extractEpisodeNumbersFromOutput,
  detectCollapsedRangeSummaries,
  findEpisodesWithCollapse,
  buildEpisodeScaffold,
} from "./episodeScope.ts";

// ─── Test fixtures ───

const SAMPLE_DOC = `# Season Overview

Some preamble text here.

## EPISODE 1: Pilot
Beat 1: Setup the world
Beat 2: Introduce protagonist
Beat 3: Inciting incident

## EPISODE 2: Rising Stakes
Beat 1: Consequence of pilot
Beat 2: New ally appears
Beat 3: First setback

## EPISODE 3: The Turn
Beat 1: Discovery
Beat 2: Betrayal
Beat 3: Cliffhanger

## EPISODE 4: Fallout
Beat 1: Aftermath
Beat 2: Regrouping
Beat 3: New plan`;

const BOLD_HEADER_DOC = `**Ep 1:** Introduction
Hook: Character enters
Core: World established
Turn: Twist revealed

**Ep 2:** Conflict
Hook: Antagonist strikes
Core: Battle ensues
Turn: Defeat

**Ep 3:** Resolution
Hook: Final gambit
Core: Climax
Turn: Resolution`;

const HASH_VARIANT_DOC = `### EP.5: Deep Dive
Exploration of subplot
Character development

### EP.6: Crossroads
Major decision point
Stakes escalate

### EP.7: No Return
Point of no return
All-in moment`;

// ─── 1. Parse standard ## EPISODE N headers ───

Deno.test("parseEpisodeBlocks: standard ## EPISODE N headers", () => {
  const blocks = parseEpisodeBlocks(SAMPLE_DOC);
  assertEquals(blocks.length, 4);
  assertEquals(blocks[0].episodeNumber, 1);
  assertEquals(blocks[1].episodeNumber, 2);
  assertEquals(blocks[2].episodeNumber, 3);
  assertEquals(blocks[3].episodeNumber, 4);
  assertEquals(blocks[0].headerLine, "## EPISODE 1: Pilot");
});

// ─── 2. Parse **Ep N:** bold variant headers ───

Deno.test("parseEpisodeBlocks: **Ep N:** bold variant headers", () => {
  const blocks = parseEpisodeBlocks(BOLD_HEADER_DOC);
  assertEquals(blocks.length, 3);
  assertEquals(blocks[0].episodeNumber, 1);
  assertEquals(blocks[1].episodeNumber, 2);
  assertEquals(blocks[2].episodeNumber, 3);
  assertEquals(blocks[0].headerLine, "**Ep 1:** Introduction");
});

// ─── 3. Parse ### EP.N: hash+dot variant ───

Deno.test("parseEpisodeBlocks: ### EP.N variant headers", () => {
  const blocks = parseEpisodeBlocks(HASH_VARIANT_DOC);
  assertEquals(blocks.length, 3);
  assertEquals(blocks[0].episodeNumber, 5);
  assertEquals(blocks[1].episodeNumber, 6);
  assertEquals(blocks[2].episodeNumber, 7);
});

// ─── 4. Merge preserves untouched episodes ───

Deno.test("mergeEpisodeBlocks: preserves untouched episodes verbatim", () => {
  const replacements = {
    2: `## EPISODE 2: Rising Stakes REWRITTEN\nBeat 1: CHANGED consequence\nBeat 2: CHANGED ally\nBeat 3: CHANGED setback`,
  };

  const result = mergeEpisodeBlocks(SAMPLE_DOC, replacements);
  assertEquals(result.replacedEpisodes, [2]);
  assertEquals(result.preservedEpisodes, [1, 3, 4]);

  const originalBlocks = parseEpisodeBlocks(SAMPLE_DOC);
  const mergedBlocks = parseEpisodeBlocks(result.mergedText);
  assertEquals(mergedBlocks[0].rawBlock, originalBlocks[0].rawBlock);
  assertEquals(mergedBlocks[2].rawBlock, originalBlocks[2].rawBlock);
  assertEquals(mergedBlocks[3].rawBlock, originalBlocks[3].rawBlock);
});

// ─── 5. Merge replaces only targeted episodes ───

Deno.test("mergeEpisodeBlocks: replaces only targeted episodes", () => {
  const newBlock = `## EPISODE 3: The Turn REWRITTEN\nBeat 1: NEW discovery\nBeat 2: NEW betrayal`;
  const replacements = { 3: newBlock };

  const result = mergeEpisodeBlocks(SAMPLE_DOC, replacements);
  assertEquals(result.replacedEpisodes, [3]);

  const mergedBlocks = parseEpisodeBlocks(result.mergedText);
  assertEquals(mergedBlocks[2].headerLine, "## EPISODE 3: The Turn REWRITTEN");
});

// ─── 6. Validation detects missing episodes ───

Deno.test("validateEpisodeMerge: detects missing episodes", () => {
  const incomplete = `## EPISODE 1: Pilot\nBeat 1\n\n## EPISODE 2: Rising\nBeat 1\n\n## EPISODE 4: Fallout\nBeat 1`;

  const validation = validateEpisodeMerge(SAMPLE_DOC, incomplete, [2]);
  assertEquals(validation.ok, false);
  assertArrayIncludes(validation.missingEpisodes, [3]);
});

// ─── 7. Validation detects mutated untouched episode ───

Deno.test("validateEpisodeMerge: detects summarised untouched block", () => {
  const mutated = SAMPLE_DOC
    .replace(
      "Beat 1: Setup the world\nBeat 2: Introduce protagonist\nBeat 3: Inciting incident",
      "Eps 1 follows established structure"
    )
    .replace(
      "Beat 1: Consequence of pilot\nBeat 2: New ally appears\nBeat 3: First setback",
      "Beat 1: REWRITTEN consequence\nBeat 2: REWRITTEN ally\nBeat 3: REWRITTEN setback"
    );

  const validation = validateEpisodeMerge(SAMPLE_DOC, mutated, [2]);
  assertEquals(validation.ok, false);
  assertArrayIncludes(validation.mutatedUntouchedEpisodes, [1]);
});

// ─── 8. Validation passes for correct merge ───

Deno.test("validateEpisodeMerge: passes when merge is correct", () => {
  const replacements = {
    2: `## EPISODE 2: Rising Stakes\nBeat 1: CHANGED\nBeat 2: CHANGED\nBeat 3: CHANGED`,
  };
  const result = mergeEpisodeBlocks(SAMPLE_DOC, replacements);
  const validation = validateEpisodeMerge(SAMPLE_DOC, result.mergedText, [2]);
  assertEquals(validation.ok, true);
  assertEquals(validation.missingEpisodes.length, 0);
  assertEquals(validation.mutatedUntouchedEpisodes.length, 0);
});

// ─── 9. extractTargetEpisodes from change plan ───

Deno.test("extractTargetEpisodes: extracts from explicit + inferred", () => {
  const plan = {
    changes: [
      { target: { episode_numbers: [5, 10] }, instructions: "Rewrite episode 5 hook" },
      { instructions: "Also adjust Ep 15 cliffhanger", title: "Fix ep. 15" },
      { target: { episode_numbers: [10] }, instructions: "Strengthen episode 10" },
    ],
  };
  const eps = extractTargetEpisodes(plan);
  assertEquals(eps, [5, 10, 15]);
});

// ─── 10. Empty/no-episode text returns empty ───

Deno.test("parseEpisodeBlocks: returns empty for non-episode text", () => {
  const blocks = parseEpisodeBlocks("Just some plain text with no episode headers at all.");
  assertEquals(blocks.length, 0);
});

// ─── 11. detectCollapsedRangeSummaries catches "Eps 1–7" ───

Deno.test("detectCollapsedRangeSummaries: catches Eps range pattern", () => {
  assertEquals(detectCollapsedRangeSummaries("Eps 1–7 follow established structure"), true);
  assertEquals(detectCollapsedRangeSummaries("Ep 2-5 remain high-density"), true);
  assertEquals(detectCollapsedRangeSummaries("Episodes continue the pattern from above"), true);
  assertEquals(detectCollapsedRangeSummaries("Use templates for remaining episodes"), true);
});

// ─── 12. detectCollapsedRangeSummaries passes clean output ───

Deno.test("detectCollapsedRangeSummaries: passes clean episode text", () => {
  assertEquals(detectCollapsedRangeSummaries(SAMPLE_DOC), false);
});

// ─── 13. extractEpisodeNumbersFromOutput extracts sorted unique ───

Deno.test("extractEpisodeNumbersFromOutput: extracts sorted unique numbers", () => {
  const text = `## EPISODE 3: Something\nbeats\n\n## EPISODE 1: Other\nbeats\n\n## EPISODE 2: More\nbeats`;
  const nums = extractEpisodeNumbersFromOutput(text);
  assertEquals(nums, [1, 2, 3]);
});

// ─── 14. buildEpisodeScaffold generates correct structure ───

Deno.test("buildEpisodeScaffold: generates N episodes with headings", () => {
  const scaffold = buildEpisodeScaffold(3);
  const blocks = parseEpisodeBlocks(scaffold);
  assertEquals(blocks.length, 3);
  assertEquals(blocks[0].episodeNumber, 1);
  assertEquals(blocks[2].episodeNumber, 3);
  assertEquals(blocks[0].headerLine, "## EPISODE 1: (Title TBD)");
});

// ─── 15. Merge with multiple replacements ───

Deno.test("mergeEpisodeBlocks: handles multiple simultaneous replacements", () => {
  const replacements = {
    1: `## EPISODE 1: Pilot REWRITTEN\nNew content`,
    4: `## EPISODE 4: Fallout REWRITTEN\nNew content`,
  };
  const result = mergeEpisodeBlocks(SAMPLE_DOC, replacements);
  assertEquals(result.replacedEpisodes, [1, 4]);
  assertEquals(result.preservedEpisodes, [2, 3]);

  const mergedBlocks = parseEpisodeBlocks(result.mergedText);
  assertEquals(mergedBlocks[0].headerLine, "## EPISODE 1: Pilot REWRITTEN");
  assertEquals(mergedBlocks[3].headerLine, "## EPISODE 4: Fallout REWRITTEN");
  // Untouched blocks preserved
  const originalBlocks = parseEpisodeBlocks(SAMPLE_DOC);
  assertEquals(mergedBlocks[1].rawBlock, originalBlocks[1].rawBlock);
  assertEquals(mergedBlocks[2].rawBlock, originalBlocks[2].rawBlock);
});

// ─── 16. Validation detects collapse tells ───

Deno.test("detectCollapsedRangeSummaries: catches 'same structure as above'", () => {
  assertEquals(detectCollapsedRangeSummaries("Episodes 8-15 use the same structure as above"), true);
  assertEquals(detectCollapsedRangeSummaries("This repeats the format of episode 1"), true);
  assertEquals(detectCollapsedRangeSummaries("(Episodes 1–8 preserved as high-density anchors)"), true);
  assertEquals(detectCollapsedRangeSummaries("Episode anchors are emotionally resonant"), false);
});

// ─── 17. findEpisodesWithCollapse: attributes collapse to Ep 8 ───

Deno.test("findEpisodesWithCollapse: attributes collapse to Ep 8 when it contains range text", () => {
  const text = `## EPISODE 7: Something\nBeat 1: Action happens\nBeat 2: More action\n\n## EPISODE 8: Another\nEps 1-7 follow established structure.\nBeat 1: Real content here`;
  const hits = findEpisodesWithCollapse(text);
  assertEquals(hits, [8]);
});

// ─── 18. findEpisodesWithCollapse: no hits on clean doc ───

Deno.test("findEpisodesWithCollapse: no hits on clean doc", () => {
  const hits = findEpisodesWithCollapse(SAMPLE_DOC);
  assertEquals(hits.length, 0);
});

// ─── 19. findEpisodesWithCollapse: multiple episodes with collapse ───

Deno.test("findEpisodesWithCollapse: detects multiple collapse episodes", () => {
  const text = `## EPISODE 1: Pilot\nBeat 1: Good content\n\n## EPISODE 2: Second\nUses the same structure as episode 1\n\n## EPISODE 3: Third\n(Episodes 1-2 preserved as high-density anchors)\nBeat 1: Content`;
  const hits = findEpisodesWithCollapse(text);
  assertEquals(hits, [2, 3]);
});
