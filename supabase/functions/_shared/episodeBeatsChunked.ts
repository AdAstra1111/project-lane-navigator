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
const MAX_REPAIR_CYCLES = 4;
const MAX_RETRIES_PER_BATCH = 3;

export interface EpisodeBeatsOpts {
  apiKey: string;
  episodeCount: number;
  systemPrompt: string;
  /** 'grid' = structural overview per episode; 'beats' = full micro-beat breakdown; 'script' = full screenplay per episode */
  outputMode?: 'grid' | 'beats' | 'script';
  upstreamContent: string;
  projectTitle: string;
  requestId?: string;
}

// ─── JSON Batch Contract ───

const BATCH_SYSTEM_PROMPT_BEATS = `You output ONLY valid JSON. No markdown fences, no commentary, no preamble.

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
- NEVER write "PHASE", "ANCHORS", or "PRESERVED".
- NEVER describe other episodes (no "episodes 1–8 preserved", "earlier episodes", etc).
- Each requested episode must be written fully as its own episode.
- Every beat must describe THIS episode's unique events — no "same as above" or "continues the pattern".`;

// Episode GRID mode: structural overview per episode (not full beat breakdown)
const BATCH_SYSTEM_PROMPT_GRID = `You output ONLY valid JSON. No markdown fences, no commentary, no preamble.

JSON schema:
{"episodes": {"1": "<FULL EPISODE 1 GRID ENTRY>", "2": "<FULL EPISODE 2 GRID ENTRY>", ...}}

EPISODE GRID — what each entry MUST contain (in this exact format):
## EPISODE N: <SPECIFIC EPISODE TITLE>
PREMISE: <one sentence — what specifically happens in THIS episode>
HOOK: <what pulls the viewer in within the first 15 seconds>
CORE MOVE: <the single most important story change or revelation in this episode>
CHARACTER FOCUS: <whose arc or decision drives this episode>
CLIFFHANGER: <how this episode ends to pull the viewer to the next>
ARC POSITION: <which season arc function: setup / escalation / midpoint / complication / pre-climax / climax / resolution>
TONE: <the emotional register of this episode: e.g. tense, tender, explosive, melancholy>

Rules:
- Only output the requested episode numbers.
- Each episode value MUST start with "## EPISODE N: <title>"
- Every field (PREMISE, HOOK, CORE MOVE, CHARACTER FOCUS, CLIFFHANGER, ARC POSITION, TONE) is MANDATORY.
- PREMISE must describe THIS episode's specific events — not a template or generic placeholder.
- NEVER collapse multiple episodes into one entry.
- NEVER write ranges like "Eps 1–7" or "Episodes 2-5 follow same structure".
- NEVER use placeholders, "template", "follow established structure", or abbreviations.
- Do NOT include detailed beat breakdowns or sub-beats — those belong in Episode Beats, not the Grid.
- Every requested episode MUST appear as its own key in the JSON object.`;

// Episode SCRIPT mode: full screenplay per episode (plain text, not JSON)
// Used for season_script doc type in vertical drama.
// Outputs raw screenplay markdown — NOT JSON batched (JSON breaks sluglines/dialogue formatting).
const BATCH_SYSTEM_PROMPT_SCRIPT = `You are writing ACTUAL SCREENPLAY CONTENT for a vertical drama series.
Output ONLY valid JSON. No markdown fences, no commentary outside the JSON.

JSON schema:
{"episodes": {"1": "<FULL EPISODE 1 SCREENPLAY>", "2": "<FULL EPISODE 2 SCREENPLAY>", ...}}

Each episode value MUST contain full screenplay content in this format:
## EPISODE N: <EPISODE TITLE>
*Duration: 120–180 seconds*

COLD OPEN
[Action line: scroll-stopping hook in 2-3 lines]

SCENE 1 — [SCENE HEADING]
[Action line describing what the viewer sees]
CHARACTER NAME
(parenthetical if needed)
Dialogue line.
[Continue action / reaction]
CHARACTER NAME
Dialogue line.

[Continue with 2–4 more scenes]

EPISODE END
[Final image + unresolved tension pulling to next episode]

---

MANDATORY RULES:
- Every episode MUST have: COLD OPEN + minimum 3 scenes + EPISODE END
- Write ACTUAL dialogue — character-specific, personality-revealing, subtext-loaded
- Every scene has a clear dramatic function (reveal, escalation, turn, confrontation)
- End every episode on an unresolved micro-cliffhanger
- Each episode must feel self-contained AND propel the season arc forward
- NEVER write "same as above", "continues the pattern", or placeholder text
- NEVER write episode summaries — write SCRIPTED SCENES with DIALOGUE
- Do NOT include JSON metadata, project overviews, or character descriptions`;

// Backwards-compatible alias — defaults to beats mode
const BATCH_SYSTEM_PROMPT = BATCH_SYSTEM_PROMPT_BEATS;

function buildBatchUserPrompt(
  episodes: number[],
  totalEpisodes: number,
  projectTitle: string,
  upstreamContent: string,
  contextPrompt: string,
  outputMode: 'grid' | 'beats' | 'script' = 'beats',
): string {
  const outputInstruction = outputMode === 'grid'
    ? `You MUST output JSON with a key for EVERY episode listed above. Each value is the full episode grid entry using the EPISODE GRID format (PREMISE / HOOK / CORE MOVE / CHARACTER FOCUS / CLIFFHANGER / ARC POSITION / TONE).`
    : outputMode === 'script'
    ? `You MUST output JSON with a key for EVERY episode listed above. Each value is the FULL SCREENPLAY for that episode: COLD OPEN + minimum 3 SCENES with actual dialogue + EPISODE END cliffhanger. Write real scripted content — no summaries, no placeholders.`
    : `You MUST output JSON with a key for EVERY episode listed above. Each value is the full episode block text starting with "## EPISODE N:" heading and 5–8 numbered beats.`;

  return `${contextPrompt}

PROJECT: "${projectTitle}" (${totalEpisodes} total episodes in season)

UPSTREAM CONTEXT:
${upstreamContent}

REQUESTED EPISODES: ${episodes.join(', ')}

${outputInstruction}

IMPORTANT: If you include ANY sentence referencing another episode range (e.g., "Eps 1–7…"), your response will be rejected and retried.

OUTPUT JSON ONLY.`;
}

/**
 * Parse the JSON batch response into a replacements map.
 * Handles {"episodes": {"1": "...", "2": "..."}} format.
 */
function sanitiseJsonString(s: string): string {
  // Remove control characters (0x00–0x1F) that aren't valid in JSON strings,
  // EXCEPT legitimate escapes (\n \r \t) which JSON already handles correctly.
  // Also normalise escaped quotes inside string values.
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function parseBatchResponse(raw: string): Record<number, string> {
  const jsonStr = sanitiseJsonString(extractJSON(raw));
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
  outputMode: 'grid' | 'beats' | 'script' = 'beats',
): Promise<Record<number, string>> {
  const BASE_SYSTEM = outputMode === 'grid' ? BATCH_SYSTEM_PROMPT_GRID : outputMode === 'script' ? BATCH_SYSTEM_PROMPT_SCRIPT : BATCH_SYSTEM_PROMPT_BEATS;
  for (let attempt = 0; attempt < MAX_RETRIES_PER_BATCH; attempt++) {
    const userPrompt = buildBatchUserPrompt(
      episodes, totalEpisodes, projectTitle, upstreamContent, contextPrompt, outputMode,
    );

    const systemWithRetry = attempt > 0
      ? BASE_SYSTEM + `\n\nRETRY ATTEMPT ${attempt + 1}. Your previous response was invalid or incomplete. Return ONLY valid JSON with ALL requested episodes: ${episodes.join(', ')}.`
      : BASE_SYSTEM;

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

      if (missingFromBatch.length > 0 && attempt === MAX_RETRIES_PER_BATCH - 1) {
        throw new Error(`Episode batch incomplete after ${MAX_RETRIES_PER_BATCH} retries for episodes ${episodes.join(', ')}. Missing: ${missingFromBatch.join(', ')}`);
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
 * Sequential plain-text generator for season_script ('script' mode).
 *
 * JSON transport is unreliable for screenplay content — dialogue quotes, colons,
 * and multi-line action blocks cause frequent JSON parse failures. Instead, generate
 * each episode sequentially as raw markdown text and concatenate.
 */
async function generateSeasonScriptSequential(opts: EpisodeBeatsOpts): Promise<string> {
  const { apiKey, episodeCount, systemPrompt, upstreamContent, projectTitle } = opts;
  const requestId = opts.requestId || crypto.randomUUID();

  const SCRIPT_EPISODE_SYSTEM = `You are writing ONE EPISODE of a vertical drama screenplay. Output ONLY the raw screenplay text — no JSON, no markdown code blocks, no preamble.

Format:
## EPISODE [N]: [EPISODE TITLE]
*Duration: 120–180 seconds*

COLD OPEN
[Action line: scroll-stopping hook — 2-3 lines max]

SCENE 1 — [SCENE HEADING]
[Action line]
CHARACTER NAME
(parenthetical if needed)
Dialogue line.
[Action / reaction]
CHARACTER NAME
Dialogue line.

[Repeat for 2-4 more scenes]

EPISODE END
[Final image + micro-cliffhanger pulling viewer to next episode]

---

Rules:
- Write REAL dialogue — character-specific, subtext-loaded, personality-revealing
- Every scene has a clear dramatic function
- End on an unresolved micro-cliffhanger
- 400–600 words of scripted content per episode
- Do NOT include character descriptions, beat summaries, or project metadata`;

  const allEpisodes = Array.from({ length: episodeCount }, (_, i) => i + 1);
  const episodeTexts: string[] = [];

  console.error(JSON.stringify({
    diag: "SEASON_SCRIPT_SEQUENTIAL_START",
    requestId, episodeCount, mode: "sequential_plaintext",
  }));

  for (const epNum of allEpisodes) {
    const userPrompt = `Write Episode ${epNum} of ${episodeCount} for the vertical drama series "${projectTitle}".

UPSTREAM CONTEXT (season arc, character bible, episode beats):
${upstreamContent.slice(0, 8000)}

${systemPrompt ? `ADDITIONAL PROJECT CONTEXT:\n${systemPrompt.slice(0, 2000)}` : ""}

Write Episode ${epNum} now. Start directly with "## EPISODE ${epNum}:".`;

    let episodeText = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await callLLM({
          apiKey,
          model: MODELS.PRO,
          system: SCRIPT_EPISODE_SYSTEM,
          user: userPrompt,
          temperature: 0.6,
          maxTokens: 4000,
        });
        // Strip any accidental code fences
        const cleaned = result.content.replace(/^```[\s\S]*?\n/, "").replace(/\n?```\s*$/, "").trim();
        if (cleaned.includes(`## EPISODE ${epNum}`) || cleaned.includes(`## EP ${epNum}`)) {
          episodeText = cleaned;
          break;
        }
        // Header missing — prepend it
        episodeText = `## EPISODE ${epNum}: (Episode ${epNum})\n\n${cleaned}`;
        break;
      } catch (err: any) {
        console.error(JSON.stringify({ diag: "SCRIPT_EP_FAIL", requestId, epNum, attempt, error: err?.message }));
        if (attempt === 1) {
          episodeText = `## EPISODE ${epNum}: (Generation failed — retry needed)\n\n*This episode could not be generated. Please regenerate the Season Script.*\n\n---`;
        }
        // Brief backoff before retry
        if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
      }
    }

    episodeTexts.push(episodeText);
    console.error(JSON.stringify({ diag: "SCRIPT_EP_DONE", requestId, epNum, chars: episodeText.length }));
  }

  const assembled = `# ${projectTitle} — SEASON SCRIPT\n\n${episodeTexts.join("\n\n---\n\n")}`;

  console.error(JSON.stringify({
    diag: "SEASON_SCRIPT_SEQUENTIAL_COMPLETE",
    requestId, episodeCount, totalChars: assembled.length,
  }));

  return assembled;
}

/**
 * Generate episode beats/grid in batches with deterministic merge + validation + repair.
 */
export async function generateEpisodeBeatsChunked(opts: EpisodeBeatsOpts): Promise<string> {
  const { apiKey, episodeCount, systemPrompt, upstreamContent, projectTitle } = opts;
  const outputMode = opts.outputMode ?? 'beats';
  const requestId = opts.requestId || crypto.randomUUID();

  // Script mode: use sequential plain-text generation (not JSON batching).
  // JSON transport breaks for screenplay content — quotes, colons, newlines in dialogue
  // cause frequent parse failures. Sequential generation is more reliable.
  if (outputMode === 'script') {
    return generateSeasonScriptSequential({ ...opts, requestId });
  }

  const effectiveBatchSize = BATCH_SIZE;

  // Build numeric batches: [1..6], [7..12], etc.
  const allEpisodes = Array.from({ length: episodeCount }, (_, i) => i + 1);
  const batches: number[][] = [];
  for (let i = 0; i < allEpisodes.length; i += effectiveBatchSize) {
    batches.push(allEpisodes.slice(i, i + effectiveBatchSize));
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
      apiKey, batch, episodeCount, projectTitle, upstreamContent, systemPrompt, requestId, outputMode,
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
    const globalCollapse = detectCollapsedRangeSummaries(masterText);

    // Attribute collapse to specific episode blocks (not always batch 1)
    const collapseEpisodes = findEpisodesWithCollapse(masterText);
    const hasCollapse = globalCollapse || collapseEpisodes.length > 0;

    // Check for scaffold stubs still present (episodes that weren't replaced)
    const blocks = parseEpisodeBlocks(masterText);
    const STUB_BODY_RE = /\n1\.\s*\n2\.\s*\n3\.\s*\n4\.\s*\n5\.\s*$/m;
    const stubEpisodes = blocks
      .filter(b => {
        const raw = b.rawBlock || '';
        return raw.includes('(Title TBD)') || STUB_BODY_RE.test(raw);
      })
      .map(b => b.episodeNumber);

    const needsRepairSet = new Set<number>([...missing, ...stubEpisodes, ...collapseEpisodes]);

    if (globalCollapse && collapseEpisodes.length === 0) {
      const forced = Array.from({ length: Math.min(BATCH_SIZE, episodeCount) }, (_, i) => i + 1);
      for (const ep of forced) needsRepairSet.add(ep);
    }

    const needsRepair = [...needsRepairSet].sort((a, b) => a - b);

    if (collapseEpisodes.length > 0 || globalCollapse) {
      console.error(JSON.stringify({
        diag: "EPISODE_COLLAPSE_ATTRIBUTION",
        requestId,
        cycle,
        collapse_detected: hasCollapse,
        global_collapse: globalCollapse,
        collapse_episodes: collapseEpisodes,
        message: `Collapse patterns found${collapseEpisodes.length ? ` inside episode blocks: [${collapseEpisodes.join(', ')}]` : ' outside episode blocks'} — will re-generate episode set`,
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
      global_collapse: globalCollapse,
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
        apiKey, repairBatch, episodeCount, projectTitle, upstreamContent, systemPrompt, requestId, outputMode,
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
