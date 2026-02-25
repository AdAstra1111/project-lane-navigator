/**
 * episodeScope — Deterministic episode block parsing + merge-based rewrite guard.
 *
 * Used by Writers' Room apply_change_plan for episode_grid, episode_beats,
 * and vertical_episode_beats doc types. Ensures untouched episodes remain
 * byte-identical after selective rewrites — NO summarization allowed.
 *
 * NO LLM calls — purely text-based episode segmentation.
 */

// ─── Types ───

export interface ParsedEpisodeBlock {
  episodeNumber: number;
  /** The full header line, e.g. "## EPISODE 9: The Betrayal" */
  headerLine: string;
  /** Body text after the header (excludes header line itself) */
  bodyText: string;
  /** The complete raw block (header + body) as extracted from original text */
  rawBlock: string;
}

export interface EpisodeMergeResult {
  mergedText: string;
  replacedEpisodes: number[];
  preservedEpisodes: number[];
}

export interface EpisodeValidationResult {
  ok: boolean;
  missingEpisodes: number[];
  mutatedUntouchedEpisodes: number[];
  errors: string[];
}

// ─── Constants ───

/**
 * Episode header regex — supports these variants:
 *   ## EPISODE 9: Title
 *   ## EP 9 — Title
 *   ### Ep.9: Title
 *   **Ep 9:** Title
 *   EP9 - Title
 *   EPISODE 9
 *   # Episode 15: Something
 *
 * Captures the episode number in group 1.
 */
const EPISODE_HEADER_RE = /^(?:#{1,3}\s+|\*{2})?(?:EPISODE\s+|EP\.?\s*)(\d+)\b[^\n]*/i;

// ─── Parsing ───

/**
 * Parse episode-structured text into ordered episode blocks.
 *
 * Splits on episode headers, preserving everything between one header
 * and the next (or EOF) as a single block.
 */
export function parseEpisodeBlocks(text: string): ParsedEpisodeBlock[] {
  if (!text || text.trim().length === 0) return [];

  const lines = text.split('\n');
  const blocks: ParsedEpisodeBlock[] = [];

  let currentHeader: string | null = null;
  let currentEpNum = 0;
  let currentHeaderLineIdx = -1;
  let bodyLines: string[] = [];

  function closeBlock() {
    if (currentHeader !== null) {
      const body = bodyLines.join('\n');
      const raw = currentHeader + '\n' + body;
      blocks.push({
        episodeNumber: currentEpNum,
        headerLine: currentHeader,
        bodyText: body,
        rawBlock: raw.trimEnd(),
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const match = EPISODE_HEADER_RE.exec(trimmed);

    if (match) {
      closeBlock();
      currentHeader = trimmed;
      currentEpNum = parseInt(match[1], 10);
      currentHeaderLineIdx = i;
      bodyLines = [];
    } else if (currentHeader !== null) {
      bodyLines.push(line);
    }
    // Lines before any episode header are ignored (preamble)
  }

  closeBlock();
  return blocks;
}

// ─── Merging ───

/**
 * Merge replacement episode blocks into the original text.
 *
 * Only episodes in `replacements` are swapped; ALL other episodes
 * remain byte-identical to the original. Preamble text (before the
 * first episode header) is also preserved verbatim.
 */
export function mergeEpisodeBlocks(
  originalText: string,
  replacements: Record<number, string>,
): EpisodeMergeResult {
  const originalBlocks = parseEpisodeBlocks(originalText);
  const replacedEpisodes: number[] = [];
  const preservedEpisodes: number[] = [];

  // Extract preamble: everything before the first episode header
  let preamble = '';
  if (originalBlocks.length > 0) {
    const firstBlockStart = originalText.indexOf(originalBlocks[0].headerLine);
    if (firstBlockStart > 0) {
      preamble = originalText.slice(0, firstBlockStart);
    }
  } else {
    // No episodes found — return original unchanged
    return { mergedText: originalText, replacedEpisodes: [], preservedEpisodes: [] };
  }

  const mergedParts: string[] = [];
  if (preamble.trim()) {
    mergedParts.push(preamble.trimEnd());
  }

  for (const block of originalBlocks) {
    if (replacements[block.episodeNumber] !== undefined) {
      mergedParts.push(replacements[block.episodeNumber].trimEnd());
      replacedEpisodes.push(block.episodeNumber);
    } else {
      mergedParts.push(block.rawBlock);
      preservedEpisodes.push(block.episodeNumber);
    }
  }

  return {
    mergedText: mergedParts.join('\n\n'),
    replacedEpisodes: replacedEpisodes.sort((a, b) => a - b),
    preservedEpisodes: preservedEpisodes.sort((a, b) => a - b),
  };
}

// ─── Validation ───

/**
 * Validate that a merged result preserves all original episodes and
 * that untouched episodes are byte-identical.
 */
export function validateEpisodeMerge(
  originalText: string,
  mergedText: string,
  targetedEpisodes: number[],
): EpisodeValidationResult {
  const originalBlocks = parseEpisodeBlocks(originalText);
  const mergedBlocks = parseEpisodeBlocks(mergedText);
  const targetedSet = new Set(targetedEpisodes);

  const errors: string[] = [];
  const missingEpisodes: number[] = [];
  const mutatedUntouchedEpisodes: number[] = [];

  // Build merged map by episode number
  const mergedMap = new Map<number, ParsedEpisodeBlock>();
  for (const b of mergedBlocks) {
    mergedMap.set(b.episodeNumber, b);
  }

  // Check: every original episode must still exist
  for (const ob of originalBlocks) {
    const mb = mergedMap.get(ob.episodeNumber);
    if (!mb) {
      missingEpisodes.push(ob.episodeNumber);
      errors.push(`Episode ${ob.episodeNumber} missing from merged output`);
      continue;
    }

    // For untouched episodes: must be byte-identical
    if (!targetedSet.has(ob.episodeNumber)) {
      if (ob.rawBlock !== mb.rawBlock) {
        mutatedUntouchedEpisodes.push(ob.episodeNumber);
        errors.push(
          `Episode ${ob.episodeNumber} was NOT targeted but was modified (original: ${ob.rawBlock.length} chars, merged: ${mb.rawBlock.length} chars)`
        );
      }
    }
  }

  return {
    ok: missingEpisodes.length === 0 && mutatedUntouchedEpisodes.length === 0,
    missingEpisodes: missingEpisodes.sort((a, b) => a - b),
    mutatedUntouchedEpisodes: mutatedUntouchedEpisodes.sort((a, b) => a - b),
    errors,
  };
}

// ─── Helpers ───

/** Episode doc types that use episode-scoped rewrites instead of scene-scoped */
export const EPISODE_DOC_TYPES = new Set([
  'episode_grid',
  'episode_beats',
  'vertical_episode_beats',
]);

/**
 * Extract target episode numbers from a change plan.
 * Looks at target.episode_numbers first, then falls back to
 * inferring from instructions text (e.g., "Episode 15").
 */
export function extractTargetEpisodes(changePlan: {
  changes?: Array<{
    target?: { episode_numbers?: number[]; scene_numbers?: number[] };
    instructions?: string;
    title?: string;
  }>;
}): number[] {
  const episodes = new Set<number>();

  for (const c of changePlan.changes || []) {
    // Explicit episode_numbers in target
    for (const en of c.target?.episode_numbers || []) {
      episodes.add(en);
    }

    // Infer from instructions/title text
    const text = `${c.instructions || ''} ${c.title || ''}`;
    const matches = text.matchAll(/\b(?:episode|ep\.?)\s*(\d+)/gi);
    for (const m of matches) {
      episodes.add(parseInt(m[1], 10));
    }
  }

  return [...episodes].sort((a, b) => a - b);
}
