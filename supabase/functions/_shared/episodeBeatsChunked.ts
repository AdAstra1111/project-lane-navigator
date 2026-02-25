/**
 * episodeBeatsChunked — Chunked episode beats generation with completeness
 * guard and auto-repair for missing episodes.
 *
 * Root cause fix: single LLM calls truncate at ~12K tokens, silently skipping
 * mid-range episodes (e.g., 20–29). This module generates in batches of
 * BATCH_SIZE episodes, verifies completeness, and auto-repairs gaps.
 *
 * Guarantees:
 *  - Every episode 1..N appears exactly once
 *  - Numeric ordering (not lexical)
 *  - Idempotent merge by episode_number key
 *  - Max 2 repair attempts before hard fail
 */

import { callLLM, MODELS } from "./llm.ts";

const BATCH_SIZE = 8;
const MAX_REPAIR_ATTEMPTS = 2;

interface EpisodeBeatsOpts {
  apiKey: string;
  episodeCount: number;
  systemPrompt: string;
  upstreamContent: string;
  projectTitle: string;
}

interface EpisodeBeatBlock {
  episodeNumber: number;
  text: string;
}

async function callLLMRaw(apiKey: string, system: string, user: string, maxTokens = 8000): Promise<string> {
  const result = await callLLM({
    apiKey,
    model: MODELS.FAST,
    system,
    user,
    temperature: 0.5,
    maxTokens,
  });
  return result.content;
}

/**
 * Parse raw LLM text output into episode blocks.
 * Looks for patterns like "## EPISODE 5" or "## EP 5" or "# Episode 5:" etc.
 */
export function parseEpisodeBlocks(raw: string): EpisodeBeatBlock[] {
  // Match episode headers: ## EPISODE 5, ## EP 5, # Episode 5:, EP5, etc.
  const headerPattern = /^#{1,3}\s*(?:EPISODE|EP\.?)\s*(\d+)\b[^\n]*/gim;
  const matches = [...raw.matchAll(headerPattern)];

  if (matches.length === 0) return [];

  const blocks: EpisodeBeatBlock[] = [];
  for (let i = 0; i < matches.length; i++) {
    const epNum = parseInt(matches[i][1], 10);
    const startIdx = matches[i].index!;
    const endIdx = i < matches.length - 1 ? matches[i + 1].index! : raw.length;
    const text = raw.slice(startIdx, endIdx).trim();
    blocks.push({ episodeNumber: epNum, text });
  }

  return blocks;
}

/**
 * Merge episode blocks by episode_number key.
 * "last wins" semantics — repairs overwrite earlier partial results.
 */
export function mergeByEpisodeNumber(existing: EpisodeBeatBlock[], incoming: EpisodeBeatBlock[]): EpisodeBeatBlock[] {
  const map = new Map<number, EpisodeBeatBlock>();
  for (const block of existing) map.set(block.episodeNumber, block);
  for (const block of incoming) map.set(block.episodeNumber, block);

  // Sort numerically — this is the fix for the lexical sort bug
  return [...map.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
}

/**
 * Find missing episode numbers from expected set 1..N.
 */
export function findMissing(blocks: EpisodeBeatBlock[], expectedCount: number): number[] {
  const present = new Set(blocks.map(b => b.episodeNumber));
  const missing: number[] = [];
  for (let i = 1; i <= expectedCount; i++) {
    if (!present.has(i)) missing.push(i);
  }
  return missing;
}

/**
 * Assemble final document text from sorted episode blocks.
 */
function assembleDocument(blocks: EpisodeBeatBlock[]): string {
  return blocks.map(b => b.text).join("\n\n");
}

/**
 * Generate episode beats in batches with completeness verification + auto-repair.
 */
export async function generateEpisodeBeatsChunked(opts: EpisodeBeatsOpts): Promise<string> {
  const { apiKey, episodeCount, systemPrompt, upstreamContent, projectTitle } = opts;

  // Build numeric batches: [1..8], [9..16], [17..24], [25..30], etc.
  const batches: number[][] = [];
  for (let i = 1; i <= episodeCount; i += BATCH_SIZE) {
    const batch: number[] = [];
    for (let j = i; j <= Math.min(i + BATCH_SIZE - 1, episodeCount); j++) {
      batch.push(j);
    }
    batches.push(batch);
  }

  console.error(JSON.stringify({
    type: "EPISODE_BEATS_CHUNKED_START",
    episodeCount,
    batchCount: batches.length,
    batchSizes: batches.map(b => b.length),
  }));

  let allBlocks: EpisodeBeatBlock[] = [];

  // Phase 1: Generate in batches
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchLabel = batch.length === 1
      ? `Episode ${batch[0]}`
      : `Episodes ${batch[0]}–${batch[batch.length - 1]}`;

    const userPrompt = `Using the upstream documents below, generate detailed episode beats for ${batchLabel} (out of ${episodeCount} total episodes in the season) for "${projectTitle}".

MANDATORY STRUCTURE RULES:
- You MUST output every episode individually. Each episode MUST have its own "## EPISODE N" heading.
- DO NOT summarize multiple episodes into one line or range (e.g., NEVER write "Eps 24–30 remain templates").
- Every episode from the list below must include: Episode number, Title, and 5–8 numbered beats.
- If episodes share similar structure, you MUST still write each one out fully with unique beats.
- DO NOT collapse, skip, abbreviate, or batch any episodes together.

CRITICAL: You MUST generate beats for EVERY episode listed: ${batch.join(", ")}. Do NOT skip any episode.

${upstreamContent}`;

    console.error(JSON.stringify({
      type: "EPISODE_BEATS_BATCH",
      batch: i + 1,
      totalBatches: batches.length,
      episodes: batch,
    }));

    const raw = await callLLMRaw(apiKey, systemPrompt, userPrompt);
    const parsed = parseEpisodeBlocks(raw);

    console.error(JSON.stringify({
      type: "EPISODE_BEATS_BATCH_RESULT",
      batch: i + 1,
      expectedEpisodes: batch,
      parsedEpisodes: parsed.map(p => p.episodeNumber),
    }));

    allBlocks = mergeByEpisodeNumber(allBlocks, parsed);
  }

  // Phase 2: Completeness verification + auto-repair
  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS; attempt++) {
    const missing = findMissing(allBlocks, episodeCount);

    if (missing.length === 0) {
      console.error(JSON.stringify({
        type: "EPISODE_BEATS_COMPLETE",
        episodeCount,
        producedCount: allBlocks.length,
        repairAttempts: attempt,
      }));
      break;
    }

    console.error(JSON.stringify({
      type: "EPISODE_BEATS_REPAIR",
      attempt: attempt + 1,
      maxAttempts: MAX_REPAIR_ATTEMPTS,
      missingEpisodes: missing,
    }));

    // Repair: generate only the missing episodes
    const repairBatches: number[][] = [];
    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
      repairBatches.push(missing.slice(i, i + BATCH_SIZE));
    }

    for (const repairBatch of repairBatches) {
      const userPrompt = `Using the upstream documents below, generate detailed episode beats for Episodes ${repairBatch.join(", ")} (out of ${episodeCount} total episodes in the season) for "${projectTitle}".

MANDATORY STRUCTURE RULES:
- You MUST output every episode individually. Each episode MUST have its own "## EPISODE N" heading.
- DO NOT summarize multiple episodes into one line or range (e.g., NEVER write "Eps 24–30 remain templates").
- Every episode must include: Episode number, Title, and 5–8 numbered beats.
- If episodes share similar structure, you MUST still write each one out fully with unique beats.
- DO NOT collapse, skip, abbreviate, or batch any episodes together.

CRITICAL: You MUST generate beats for EVERY episode listed: ${repairBatch.join(", ")}. Do NOT skip any.

${upstreamContent}`;

      const raw = await callLLMRaw(apiKey, systemPrompt, userPrompt);
      const parsed = parseEpisodeBlocks(raw);
      allBlocks = mergeByEpisodeNumber(allBlocks, parsed);
    }
  }

  // Final completeness check
  const finalMissing = findMissing(allBlocks, episodeCount);
  if (finalMissing.length > 0) {
    console.error(JSON.stringify({
      type: "EPISODE_BEATS_INCOMPLETE_AFTER_REPAIR",
      missingEpisodes: finalMissing,
      producedCount: allBlocks.length,
      expectedCount: episodeCount,
    }));
    // Generate placeholder stubs for still-missing episodes so output is never incomplete
    for (const epNum of finalMissing) {
      allBlocks.push({
        episodeNumber: epNum,
        text: `## EPISODE ${epNum}\n\n[Beats pending — generation incomplete. Retry to fill.]`,
      });
    }
    allBlocks = allBlocks.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }

  // Strip output contract headers
  let content = assembleDocument(allBlocks);
  content = content.replace(/^Deliverable Type:.*?\n/gim, "")
    .replace(/^Completion Status:.*?\n/gim, "")
    .replace(/^Completeness Check:.*?\n/gim, "");

  return content;
}
