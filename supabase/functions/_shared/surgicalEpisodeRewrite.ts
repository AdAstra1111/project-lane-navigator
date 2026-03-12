/**
 * surgicalEpisodeRewrite.ts — Targeted episode-level patching for large episode docs.
 *
 * Instead of regenerating an entire season (30–60 episodes) to apply a change,
 * this module:
 *   1. Parses the document into individual episode blocks
 *   2. Identifies which episodes are affected by the note/change
 *   3. Rewrites ONLY those episodes (with surrounding context for continuity)
 *   4. Patches the results back into the full document
 *
 * Supports: episode_grid, episode_beats, vertical_episode_beats, season_script
 * Called from: apply-note-fix, dev-engine-v2 rewrite path
 */

export const SURGICAL_EPISODE_DOC_TYPES = new Set([
  "episode_grid",
  "episode_beats",
  "vertical_episode_beats",
  "season_script",
  "season_master_script",
]);

// ─── Episode block parser ───────────────────────────────────────────────────

export interface EpisodeBlock {
  number: number;
  header: string; // e.g. "## EPISODE 7: The Ransom Call"
  content: string; // full block text including header
}

/**
 * Splits a full episode document into individual episode blocks.
 * Handles: "## EPISODE 7:", "# EPISODE 7:", "EPISODE 7:", "Episode 7:"
 * Returns blocks in episode-number order.
 */
export function parseEpisodeBlocks(plaintext: string): Map<number, EpisodeBlock> {
  const blocks = new Map<number, EpisodeBlock>();

  // Match ## EPISODE N: ... (any heading level, case-insensitive)
  const EPISODE_RE = /^#{0,3}\s*episode\s+(\d+)\s*[:\-–]/im;

  // Split on episode headers (keep the delimiter)
  const parts = plaintext.split(/(?=^#{0,3}\s*episode\s+\d+\s*[:\-–])/im);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const match = trimmed.match(EPISODE_RE);
    if (!match) continue;
    const num = parseInt(match[1], 10);
    if (isNaN(num)) continue;

    // Header is everything up to the first newline
    const header = trimmed.split("\n")[0].trim();
    blocks.set(num, { number: num, header, content: trimmed });
  }

  return blocks;
}

/**
 * Reconstructs a full document from episode blocks, preserving original order.
 * Patches (new content) override the originals for affected episodes.
 */
export function patchEpisodeBlocks(
  original: Map<number, EpisodeBlock>,
  patches: Map<number, string>,
): string {
  const allNums = Array.from(new Set([...original.keys()])).sort((a, b) => a - b);
  const parts: string[] = [];

  for (const num of allNums) {
    const patched = patches.get(num);
    if (patched) {
      parts.push(patched.trim());
    } else {
      const orig = original.get(num);
      if (orig) parts.push(orig.content.trim());
    }
  }

  return parts.join("\n\n---\n\n");
}

// ─── Affected episode detection ──────────────────────────────────────────────

/**
 * Extracts explicitly mentioned episode numbers from a note string.
 * Handles: "episode 7", "episodes 3, 4, 5", "ep 12", "eps 7-10", "episode 3 and 5"
 */
export function extractMentionedEpisodes(note: string): number[] {
  const mentioned = new Set<number>();

  // Range: "episodes 7-10" or "eps 3–7"
  const rangeRe = /\bepisodes?\s+(\d+)\s*[-–]\s*(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(note)) !== null) {
    const start = parseInt(m[1], 10);
    const end = parseInt(m[2], 10);
    for (let i = start; i <= Math.min(end, start + 20); i++) mentioned.add(i); // cap at 20
  }

  // List: "episodes 3, 4 and 7" or "eps 12, 15"
  const listRe = /\bepisodes?\s+((?:\d+(?:\s*,\s*|\s+and\s+|\s+&\s+))*\d+)/gi;
  while ((m = listRe.exec(note)) !== null) {
    const nums = m[1].match(/\d+/g) || [];
    nums.forEach((n) => mentioned.add(parseInt(n, 10)));
  }

  // Single: "episode 7" or "ep 12"
  const singleRe = /\bep(?:isode)?\s+(\d+)\b/gi;
  while ((m = singleRe.exec(note)) !== null) {
    mentioned.add(parseInt(m[1], 10));
  }

  return Array.from(mentioned).sort((a, b) => a - b);
}

/**
 * Asks the LLM to identify affected episodes when none are explicitly mentioned.
 * Returns episode numbers as an array (capped at MAX_SURGICAL_EPISODES).
 */
export async function llmIdentifyAffectedEpisodes(
  apiKey: string,
  note: string,
  episodeHeaders: string[],
  totalEpisodes: number,
  callLLM: (system: string, user: string) => Promise<string>,
): Promise<number[]> {
  const MAX = 10;
  const headerSample = episodeHeaders.slice(0, 60).join("\n");

  const system = `You are a story editor. Identify which episodes are affected by a given change note.
Output ONLY a JSON array of episode numbers, e.g. [3, 7, 12]. No explanation. Maximum ${MAX} episodes.
If the change is structural and affects ALL episodes, output [].`;

  const user = `TOTAL EPISODES: ${totalEpisodes}

EPISODE LIST (titles only):
${headerSample}

CHANGE NOTE:
${note}

Which episode numbers need to be rewritten to implement this change? Output a JSON array only.`;

  try {
    const raw = await callLLM(system, user);
    const match = raw.match(/\[[\d,\s]+\]/);
    if (!match) return [];
    const nums = JSON.parse(match[0]) as number[];
    return nums.filter((n) => Number.isInteger(n) && n >= 1 && n <= totalEpisodes).slice(0, MAX);
  } catch {
    return [];
  }
}

// ─── Single-episode rewrite ──────────────────────────────────────────────────

const MAX_CONTEXT_CHARS = 800;

/**
 * Rewrites a single episode based on a change note.
 * Provides prev/next episode as context for continuity.
 */
export async function rewriteSingleEpisode(
  episodeBlock: EpisodeBlock,
  note: string,
  prevBlock: EpisodeBlock | null,
  nextBlock: EpisodeBlock | null,
  docType: string,
  upstreamContext: string,
  callLLM: (system: string, user: string) => Promise<string>,
): Promise<string> {
  const isScript = docType === "season_script" || docType === "season_master_script";
  const isGrid = docType === "episode_grid";

  const formatInstruction = isScript
    ? `Output the complete rewritten episode screenplay in the same format (COLD OPEN, SCENE 1–3+, EPISODE END). No JSON. No markdown fences.`
    : isGrid
    ? `Output the complete rewritten episode grid entry with all fields: PREMISE, HOOK, CORE MOVE, CHARACTER COST, CLIFFHANGER, ARC POSITION, TONE. No JSON. Start with ## EPISODE ${episodeBlock.number}:`
    : `Output the complete rewritten episode beats in the same format (## EPISODE N: title, numbered beats). No JSON. Preserve beat count.`;

  const prevContext = prevBlock
    ? `PREVIOUS EPISODE (${prevBlock.number}):\n${prevBlock.content.slice(0, MAX_CONTEXT_CHARS)}`
    : "";
  const nextContext = nextBlock
    ? `FOLLOWING EPISODE (${nextBlock.number}):\n${nextBlock.content.slice(0, MAX_CONTEXT_CHARS)}`
    : "";

  const system = `You are a surgical story editor. Rewrite ONLY the specified episode to implement the change note.
Preserve everything that doesn't need to change. Maintain continuity with surrounding episodes.
${formatInstruction}`;

  const user = `CHANGE TO IMPLEMENT:
${note}

${upstreamContext ? `PROJECT CONTEXT:\n${upstreamContext.slice(0, 1500)}\n\n` : ""}${prevContext ? `${prevContext}\n\n` : ""}EPISODE TO REWRITE:
${episodeBlock.content}

${nextContext ? `${nextContext}\n\n` : ""}Rewrite Episode ${episodeBlock.number} to implement the change. Output the rewritten episode only.`;

  const result = await callLLM(system, user);
  // Ensure it starts with the episode header
  if (!result.trim().match(/^#{0,3}\s*episode\s+\d+/im)) {
    return `## EPISODE ${episodeBlock.number}: ${episodeBlock.header.replace(/^##?\s*episode\s+\d+[:\-–]?\s*/i, "").trim()}\n\n${result.trim()}`;
  }
  return result.trim();
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export interface SurgicalRewriteParams {
  plaintext: string;
  note: string;
  docType: string;
  upstreamContext?: string;
  totalEpisodes?: number;
  callLLM: (system: string, user: string) => Promise<string>;
  onProgress?: (msg: string) => void;
}

export interface SurgicalRewriteResult {
  success: boolean;
  rewrittenText: string;
  affectedEpisodes: number[];
  totalEpisodes: number;
  detectionMethod: "explicit" | "llm" | "full_rewrite";
  error?: string;
}

/**
 * Main surgical rewrite orchestrator.
 * Returns the full document with only affected episodes patched.
 * Falls back to full rewrite signal if change is global (no specific episodes identified).
 */
export async function surgicalEpisodeRewrite(
  params: SurgicalRewriteParams,
): Promise<SurgicalRewriteResult> {
  const { plaintext, note, docType, upstreamContext = "", callLLM, onProgress } = params;

  // Parse into episode blocks
  const blocks = parseEpisodeBlocks(plaintext);
  const totalEpisodes = params.totalEpisodes || blocks.size;

  if (blocks.size === 0) {
    return {
      success: false,
      rewrittenText: plaintext,
      affectedEpisodes: [],
      totalEpisodes: 0,
      detectionMethod: "full_rewrite",
      error: "Could not parse episode blocks from document",
    };
  }

  // Step 1: try to extract explicitly mentioned episode numbers
  let affectedNums = extractMentionedEpisodes(note);
  let detectionMethod: "explicit" | "llm" | "full_rewrite" = "explicit";

  // Step 2: if nothing explicit, ask LLM to identify affected episodes
  if (affectedNums.length === 0) {
    onProgress?.("Identifying affected episodes via LLM...");
    const headers = Array.from(blocks.values()).map((b) => b.header);
    affectedNums = await llmIdentifyAffectedEpisodes(callLLM, note, headers, totalEpisodes, callLLM);
    detectionMethod = affectedNums.length > 0 ? "llm" : "full_rewrite";
  }

  // Step 3: if no specific episodes found → signal full rewrite needed
  if (affectedNums.length === 0) {
    return {
      success: false,
      rewrittenText: plaintext,
      affectedEpisodes: [],
      totalEpisodes: blocks.size,
      detectionMethod: "full_rewrite",
      error: "Change affects all episodes — full regeneration required",
    };
  }

  // Step 4: validate episode numbers are in the document
  const validNums = affectedNums.filter((n) => blocks.has(n));
  if (validNums.length === 0) {
    return {
      success: false,
      rewrittenText: plaintext,
      affectedEpisodes: affectedNums,
      totalEpisodes: blocks.size,
      detectionMethod,
      error: `Identified episodes [${affectedNums.join(", ")}] not found in document`,
    };
  }

  // Step 5: rewrite each affected episode with context
  const patches = new Map<number, string>();
  const allNums = Array.from(blocks.keys()).sort((a, b) => a - b);

  for (const epNum of validNums) {
    onProgress?.(`Rewriting episode ${epNum}...`);
    const block = blocks.get(epNum)!;

    const idx = allNums.indexOf(epNum);
    const prevBlock = idx > 0 ? blocks.get(allNums[idx - 1]) ?? null : null;
    const nextBlock = idx < allNums.length - 1 ? blocks.get(allNums[idx + 1]) ?? null : null;

    const rewritten = await rewriteSingleEpisode(
      block,
      note,
      prevBlock,
      nextBlock,
      docType,
      upstreamContext,
      callLLM,
    );
    patches.set(epNum, rewritten);
  }

  // Step 6: patch back into full document
  const rewrittenText = patchEpisodeBlocks(blocks, patches);

  return {
    success: true,
    rewrittenText,
    affectedEpisodes: validNums,
    totalEpisodes: blocks.size,
    detectionMethod,
  };
}
