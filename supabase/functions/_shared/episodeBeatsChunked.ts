/**
 * episodeBeatsChunked — Chunked episode beats generation with JSON-per-episode
 * contract, deterministic merge, collapse detection, and auto-repair.
 *
 * Guarantees:
 *  - Every episode 1..N appears exactly once with full heading + beats
 *  - Untouched episodes are never regenerated or summarised
 *  - Collapsed range summaries ("Eps 1–7…") are detected and repaired
 *  - Max 2 repair cycles before hard fail
 *  - Numeric ordering (not lexical)
 */

import { callLLM, MODELS, extractJSON } from "./llm.ts";
import {
  parseEpisodeBlocks,
  mergeEpisodeBlocks,
  extractEpisodeNumbersFromOutput,
  detectCollapsedRangeSummaries,
  findEpisodesWithCollapse,
  buildEpisodeScaffold,
} from "./episodeScope.ts";

const BATCH_SIZE = 6;
const MAX_REPAIR_CYCLES = 2;
const MAX_RETRIES_PER_BATCH = 3;

export interface EpisodeBeatsOpts {
  apiKey: string;
  episodeCount: number;
  systemPrompt: string;
  upstreamContent: string;
  projectTitle: string;
  requestId?: string;
}

// ─── JSON Batch Contract ───

const BATCH_SYSTEM_PROMPT = `You output ONLY valid JSON. No markdown fences, no commentary, no preamble.

JSON schema:
{"episodes": {"1": "<FULL EPISODE 1 BLOCK>", "2": "<FULL EPISODE 2 BLOCK>", ...}}

Rules:
- Only output the requested episode numbers.
- Each episode value MUST start with a heading line: "## EPISODE N: <title>"
- Each episode MUST include 5–8 numbered beats.
- NEVER collapse multiple episodes into one entry.
- NEVER write ranges like "Eps 1–7" or "Episodes 2-5 follow same structure".
- NEVER use placeholders, "template", "follow established structure", or abbreviations.
- Every requested episode MUST appear as its own key in the JSON object.
- Do NOT reference other episodes by range or shorthand (e.g., "Eps 1–7…") anywhere inside an episode block.
- Do NOT include meta commentary about the season structure.
- Every beat must describe THIS episode's unique events — no "same as above" or "continues the pattern".`;

function buildBatchUserPrompt(
  episodes: number[],
  totalEpisodes: number,
  projectTitle: string,
  upstreamContent: string,
  contextPrompt: string,
): string {
  return `${contextPrompt}

PROJECT: "${projectTitle}" (${totalEpisodes} total episodes in season)

UPSTREAM CONTEXT:
${upstreamContent}

REQUESTED EPISODES: ${episodes.join(', ')}

You MUST output JSON with a key for EVERY episode listed above. Each value is the full episode block text starting with "## EPISODE N:" heading and 5–8 numbered beats.

IMPORTANT: If you include ANY sentence referencing another episode range (e.g., "Eps 1–7…"), your response will be rejected and retried.

OUTPUT JSON ONLY.`;
}

/**
 * Parse the JSON batch response into a replacements map.
 * Handles {"episodes": {"1": "...", "2": "..."}} format.
 */
function parseBatchResponse(raw: string): Record<number, string> {
  const jsonStr = extractJSON(raw);
  const parsed = JSON.parse(jsonStr);

  const episodes = parsed.episodes || parsed;
  const replacements: Record<number, string> = {};

  for (const [key, value] of Object.entries(episodes)) {
    const epNum = parseInt(key, 10);
    if (!isNaN(epNum) && typeof value === 'string' && value.trim().length > 0) {
      replacements[epNum] = value.trim();
    }
  }

  return replacements;
}

/**
 * Call LLM for a batch of episodes with retry logic.
 */
async function generateBatch(
  apiKey: string,
  episodes: number[],
  totalEpisodes: number,
  projectTitle: string,
  upstreamContent: string,
  contextPrompt: string,
  requestId: string,
): Promise<Record<number, string>> {
  for (let attempt = 0; attempt < MAX_RETRIES_PER_BATCH; attempt++) {
    const userPrompt = buildBatchUserPrompt(
      episodes, totalEpisodes, projectTitle, upstreamContent, contextPrompt,
    );

    const systemWithRetry = attempt > 0
      ? BATCH_SYSTEM_PROMPT + `\n\nRETRY ATTEMPT ${attempt + 1}. Your previous response was invalid or incomplete. Return ONLY valid JSON with ALL requested episodes: ${episodes.join(', ')}.`
      : BATCH_SYSTEM_PROMPT;

    console.error(JSON.stringify({
      diag: "EPISODE_BATCH_CALL",
      requestId,
      episodes,
      attempt: attempt + 1,
      maxRetries: MAX_RETRIES_PER_BATCH,
    }));

    try {
      const result = await callLLM({
        apiKey,
        model: MODELS.FAST,
        system: systemWithRetry,
        user: userPrompt,
        temperature: 0.5,
        maxTokens: 8000,
      });

      const replacements = parseBatchResponse(result.content);
      const gotEpisodes = Object.keys(replacements).map(Number).sort((a, b) => a - b);
      const missingFromBatch = episodes.filter(e => !gotEpisodes.includes(e));

      console.error(JSON.stringify({
        diag: "EPISODE_BATCH_RESULT",
        requestId,
        requested: episodes,
        received: gotEpisodes,
        missing: missingFromBatch,
        attempt: attempt + 1,
      }));

      if (missingFromBatch.length === 0) {
        return replacements;
      }

      // If some missing, try to use what we got + retry for missing on next attempt
      if (Object.keys(replacements).length > 0 && attempt < MAX_RETRIES_PER_BATCH - 1) {
        // Partial success — we'll merge what we have and the outer loop will repair missing
        if (gotEpisodes.length >= episodes.length / 2) {
          return replacements; // Good enough, repair loop handles the rest
        }
      }
    } catch (err) {
      console.error(JSON.stringify({
        diag: "EPISODE_BATCH_ERROR",
        requestId,
        episodes,
        attempt: attempt + 1,
        error: String(err),
      }));

      if (attempt === MAX_RETRIES_PER_BATCH - 1) {
        throw new Error(`Episode batch generation failed after ${MAX_RETRIES_PER_BATCH} retries for episodes ${episodes.join(', ')}: ${err}`);
      }
    }
  }

  return {};
}

/**
 * Generate episode beats/grid in batches with deterministic merge + validation + repair.
 */
export async function generateEpisodeBeatsChunked(opts: EpisodeBeatsOpts): Promise<string> {
  const { apiKey, episodeCount, systemPrompt, upstreamContent, projectTitle } = opts;
  const requestId = opts.requestId || crypto.randomUUID();

  // Build numeric batches: [1..6], [7..12], etc.
  const allEpisodes = Array.from({ length: episodeCount }, (_, i) => i + 1);
  const batches: number[][] = [];
  for (let i = 0; i < allEpisodes.length; i += BATCH_SIZE) {
    batches.push(allEpisodes.slice(i, i + BATCH_SIZE));
  }

  console.error(JSON.stringify({
    diag: "EPISODE_CHUNKED_START",
    requestId,
    episodeCount,
    batchCount: batches.length,
    batchSize: BATCH_SIZE,
    batches: batches.map(b => `${b[0]}-${b[b.length - 1]}`),
  }));

  // Start with a deterministic scaffold
  let masterText = buildEpisodeScaffold(episodeCount);

  // Phase 1: Generate in batches, merging into scaffold
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];

    const replacements = await generateBatch(
      apiKey, batch, episodeCount, projectTitle, upstreamContent, systemPrompt, requestId,
    );

    // Merge into master text — untouched episodes stay byte-identical
    const mergeResult = mergeEpisodeBlocks(masterText, replacements);
    masterText = mergeResult.mergedText;

    console.error(JSON.stringify({
      diag: "EPISODE_BATCH_MERGED",
      requestId,
      batch: i + 1,
      totalBatches: batches.length,
      replaced: mergeResult.replacedEpisodes,
      preserved: mergeResult.preservedEpisodes,
    }));
  }

  // Phase 2: Validation + Repair
  for (let cycle = 0; cycle < MAX_REPAIR_CYCLES; cycle++) {
    const extracted = extractEpisodeNumbersFromOutput(masterText);
    const missing = allEpisodes.filter(n => !extracted.includes(n));
    const hasCollapse = detectCollapsedRangeSummaries(masterText);

    // Attribute collapse to specific episode blocks (not always batch 1)
    const collapseEpisodes = findEpisodesWithCollapse(masterText);

    // Check for scaffold stubs still present (episodes that weren't replaced)
    const blocks = parseEpisodeBlocks(masterText);
    const STUB_BODY_RE = /^\s*1\.\s*\n\s*2\.\s*\n\s*3\.\s*\n\s*4\.\s*\n\s*5\.\s*$/m;
    const stubEpisodes = blocks
      .filter(b => b.rawBlock.includes('(Title TBD)') || STUB_BODY_RE.test(b.bodyText.trim()))
      .map(b => b.episodeNumber);

    const needsRepair = [...new Set([...missing, ...stubEpisodes, ...collapseEpisodes])].sort((a, b) => a - b);

    if (collapseEpisodes.length > 0) {
      console.error(JSON.stringify({
        diag: "EPISODE_COLLAPSE_ATTRIBUTION",
        requestId,
        cycle,
        collapse_episodes: collapseEpisodes,
        message: `Collapse patterns found inside episode blocks: [${collapseEpisodes.join(', ')}] — will re-generate these`,
      }));
    }

    console.error(JSON.stringify({
      diag: "EPISODE_VALIDATION",
      requestId,
      cycle,
      extracted_count: extracted.length,
      expected_count: episodeCount,
      missing,
      stub_episodes: stubEpisodes,
      collapse_episodes: collapseEpisodes,
      collapse_detected: hasCollapse,
      needs_repair: needsRepair,
    }));

    if (needsRepair.length === 0 && !hasCollapse) {
      console.error(JSON.stringify({
        diag: "EPISODE_GENERATION_COMPLETE",
        requestId,
        episodeCount,
        producedCount: extracted.length,
        repairCycles: cycle,
      }));
      break;
    }

    if (cycle === MAX_REPAIR_CYCLES - 1) {
      if (needsRepair.length > 0 || hasCollapse) {
        const errMsg = `Episode generation incomplete after ${MAX_REPAIR_CYCLES} repair cycles: missing/bad episodes [${needsRepair.join(', ')}], collapseEpisodes=[${collapseEpisodes.join(', ')}], collapseDetected=${hasCollapse}`;
        console.error(JSON.stringify({
          diag: "⚠️ EPISODE_GENERATION_FAILED",
          requestId,
          missing: needsRepair,
          collapse_episodes: collapseEpisodes,
          collapse_detected: hasCollapse,
          message: errMsg,
        }));
        throw new Error(errMsg);
      }
    }

    // Repair: generate only the episodes that need it
    const repairBatches: number[][] = [];
    for (let i = 0; i < needsRepair.length; i += BATCH_SIZE) {
      repairBatches.push(needsRepair.slice(i, i + BATCH_SIZE));
    }

    for (const repairBatch of repairBatches) {
      console.error(JSON.stringify({
        diag: "EPISODE_REPAIR_BATCH",
        requestId,
        cycle: cycle + 1,
        episodes: repairBatch,
      }));

      const replacements = await generateBatch(
        apiKey, repairBatch, episodeCount, projectTitle, upstreamContent, systemPrompt, requestId,
      );

      const mergeResult = mergeEpisodeBlocks(masterText, replacements);
      masterText = mergeResult.mergedText;
    }
  }

  // Strip output contract headers
  masterText = masterText
    .replace(/^Deliverable Type:.*?\n/gim, "")
    .replace(/^Completion Status:.*?\n/gim, "")
    .replace(/^Completeness Check:.*?\n/gim, "");

  return masterText;
}
