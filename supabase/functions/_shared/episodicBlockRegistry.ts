/**
 * Episodic Block Registry — Phase 2D-B
 *
 * Deterministic episode-block addressing and repair for episode-structured
 * development documents. Wraps episodeScope.ts parsing/merging with
 * issue-to-episode resolution and integrity validation.
 *
 * Safe rollout: episode_beats, vertical_episode_beats ONLY.
 * episode_grid is AGGREGATE (no LLM rewrites) — excluded.
 * Scripts are excluded — require a later scene-level engine.
 *
 * Fail-closed: if episode targeting is ambiguous, returns full_doc fallback.
 */

import {
  parseEpisodeBlocks,
  mergeEpisodeBlocks,
  validateEpisodeMerge,
  type ParsedEpisodeBlock,
} from "./episodeScope.ts";

// ── Types ──

export interface EpisodicBlockConfig {
  doc_type: string;
  /** Whether this doc type supports episode-block repair */
  episode_block_repair_supported: boolean;
  /** Minimum episode count to activate block repair (below this, full-doc is safer) */
  min_episodes_required: number;
}

export type EpisodicRepairTargetType = "episode_block" | "full_doc";

export interface EpisodicRepairTarget {
  repair_target_type: EpisodicRepairTargetType;
  episode_number: number | null;
  reason: string;
  fallback_reason: string | null;
  block_content: string | null;
  full_content: string;
  total_episodes: number;
}

export interface EpisodicBlockIntegrityResult {
  ok: boolean;
  merged_content: string;
  episodes_preserved: number;
  episodes_corrected: number;
  episodes_missing: number[];
  target_episode_found: boolean;
  reason: string;
}

// ── Registry ──

const EPISODIC_BLOCK_REGISTRY: Record<string, EpisodicBlockConfig> = {
  episode_beats: {
    doc_type: "episode_beats",
    episode_block_repair_supported: true,
    min_episodes_required: 3,
  },
  vertical_episode_beats: {
    doc_type: "vertical_episode_beats",
    episode_block_repair_supported: true,
    min_episodes_required: 3,
  },
  episode_grid: {
    doc_type: "episode_grid",
    episode_block_repair_supported: true,
    min_episodes_required: 3,
  },
  season_script: {
    doc_type: "season_script",
    episode_block_repair_supported: true,
    min_episodes_required: 3,
  },
  season_master_script: {
    doc_type: "season_master_script",
    episode_block_repair_supported: true,
    min_episodes_required: 3,
  },
};

// ── Public API ──

/**
 * Check whether a doc type supports episode-block repair.
 */
export function isEpisodicBlockRepairSupported(docType: string): boolean {
  return EPISODIC_BLOCK_REGISTRY[docType]?.episode_block_repair_supported === true;
}

/**
 * Get episodic block config for a doc type. Returns null if not supported.
 */
export function getEpisodicBlockConfig(docType: string): EpisodicBlockConfig | null {
  return EPISODIC_BLOCK_REGISTRY[docType] || null;
}

/**
 * List doc types that support episode-block repair.
 */
export function listEpisodicBlockRepairDocTypes(): string[] {
  return Object.keys(EPISODIC_BLOCK_REGISTRY).filter(
    k => EPISODIC_BLOCK_REGISTRY[k].episode_block_repair_supported
  );
}

// ── Issue-to-Episode Resolution ──

/**
 * Resolve an issue/note to a specific episode number.
 * Uses explicit episodeIndex, category/anchor patterns, and text scanning.
 * Fails closed: returns null if no confident single-episode match.
 */
export function resolveIssueToEpisodeNumber(
  issue: {
    episodeIndex?: number | null;
    category?: string | null;
    title?: string;
    summary?: string;
    anchor?: string | null;
    constraint_key?: string | null;
  },
  docType: string,
  content: string,
): { episode_number: number; confidence: "high" | "medium"; reason: string } | null {
  const config = EPISODIC_BLOCK_REGISTRY[docType];
  if (!config || !config.episode_block_repair_supported) return null;

  const blocks = parseEpisodeBlocks(content);
  if (blocks.length < config.min_episodes_required) return null;

  const episodeSet = new Set(blocks.map(b => b.episodeNumber));

  // 1. Explicit episodeIndex (high confidence)
  if (issue.episodeIndex != null && episodeSet.has(issue.episodeIndex)) {
    return {
      episode_number: issue.episodeIndex,
      confidence: "high",
      reason: `explicit_episode_index:${issue.episodeIndex}`,
    };
  }

  // 2. Extract from text fields: "Episode N" / "Ep N" / "EP N"
  const searchText = [
    issue.title || "",
    issue.summary || "",
    issue.anchor || "",
    issue.constraint_key || "",
    issue.category || "",
  ].join(" ");

  const epPattern = /\b(?:episode|ep\.?)\s*(\d+)\b/gi;
  const matches = [...searchText.matchAll(epPattern)];
  const extractedNums = [...new Set(matches.map(m => parseInt(m[1], 10)))].filter(
    n => !isNaN(n) && episodeSet.has(n)
  );

  if (extractedNums.length === 1) {
    return {
      episode_number: extractedNums[0],
      confidence: "medium",
      reason: `text_extraction:episode_${extractedNums[0]}`,
    };
  }

  // Multiple episodes referenced or none found — fail closed
  return null;
}

// ── Episode Block Extract / Replace ──

/**
 * Extract a specific episode block from content.
 * Returns null if episode not found.
 */
export function extractEpisodeBlock(
  content: string,
  episodeNumber: number,
): { content: string; block: ParsedEpisodeBlock } | null {
  const blocks = parseEpisodeBlocks(content);
  const match = blocks.find(b => b.episodeNumber === episodeNumber);
  if (!match) return null;
  return { content: match.rawBlock, block: match };
}

/**
 * Replace a specific episode block in the document, preserving all others verbatim.
 * Uses the battle-tested mergeEpisodeBlocks from episodeScope.ts.
 */
export function replaceEpisodeBlock(
  content: string,
  episodeNumber: number,
  newBlockContent: string,
): { success: boolean; new_content: string; reason: string } {
  const blocks = parseEpisodeBlocks(content);
  if (!blocks.find(b => b.episodeNumber === episodeNumber)) {
    return { success: false, new_content: content, reason: `episode_${episodeNumber}_not_found` };
  }

  const result = mergeEpisodeBlocks(content, { [episodeNumber]: newBlockContent });
  return {
    success: true,
    new_content: result.mergedText,
    reason: `episode_${episodeNumber}_replaced:preserved=${result.preservedEpisodes.length}`,
  };
}

// ── Repair Target Resolution ──

/**
 * Determine the optimal repair target for an issue against an episodic document.
 * Returns either an episode-block target or full_doc fallback with reason.
 */
export function getEpisodeRepairTarget(
  issue: {
    episodeIndex?: number | null;
    category?: string | null;
    title?: string;
    summary?: string;
    anchor?: string | null;
    constraint_key?: string | null;
  },
  docType: string,
  content: string,
): EpisodicRepairTarget {
  const config = EPISODIC_BLOCK_REGISTRY[docType];

  if (!config || !config.episode_block_repair_supported) {
    return {
      repair_target_type: "full_doc",
      episode_number: null,
      reason: "doc_type_not_supported_for_episode_block_repair",
      fallback_reason: null,
      block_content: null,
      full_content: content,
      total_episodes: 0,
    };
  }

  const blocks = parseEpisodeBlocks(content);
  if (blocks.length < config.min_episodes_required) {
    return {
      repair_target_type: "full_doc",
      episode_number: null,
      reason: "insufficient_episodes_found",
      fallback_reason: `found=${blocks.length}, required=${config.min_episodes_required}`,
      block_content: null,
      full_content: content,
      total_episodes: blocks.length,
    };
  }

  const resolution = resolveIssueToEpisodeNumber(issue, docType, content);
  if (!resolution) {
    return {
      repair_target_type: "full_doc",
      episode_number: null,
      reason: "episode_resolution_failed_closed",
      fallback_reason: "no_confident_single_episode_match",
      block_content: null,
      full_content: content,
      total_episodes: blocks.length,
    };
  }

  const extracted = extractEpisodeBlock(content, resolution.episode_number);
  if (!extracted) {
    return {
      repair_target_type: "full_doc",
      episode_number: resolution.episode_number,
      reason: "episode_block_extraction_failed",
      fallback_reason: `matched_ep=${resolution.episode_number}_but_extract_failed`,
      block_content: null,
      full_content: content,
      total_episodes: blocks.length,
    };
  }

  return {
    repair_target_type: "episode_block",
    episode_number: resolution.episode_number,
    reason: `episode_targeted:${resolution.reason}:confidence=${resolution.confidence}`,
    fallback_reason: null,
    block_content: extracted.content,
    full_content: content,
    total_episodes: blocks.length,
  };
}

// ── Post-Rewrite Integrity Enforcement ──

/**
 * After a rewrite, enforce episode-block integrity:
 * - Parse both original and rewritten into episode blocks
 * - Preserve all non-targeted episodes verbatim from original
 * - Validate episode count and numbering
 *
 * Returns the merged content with integrity enforced.
 */
export function enforceEpisodeBlockIntegrity(
  originalContent: string,
  rewrittenContent: string,
  targetEpisodeNumber: number,
): EpisodicBlockIntegrityResult {
  const originalBlocks = parseEpisodeBlocks(originalContent);
  const rewrittenBlocks = parseEpisodeBlocks(rewrittenContent);

  if (originalBlocks.length === 0) {
    return {
      ok: false,
      merged_content: rewrittenContent,
      episodes_preserved: 0,
      episodes_corrected: 0,
      episodes_missing: [],
      target_episode_found: false,
      reason: "no_episodes_in_original",
    };
  }

  // Check if target episode exists in rewritten output
  const targetInRewritten = rewrittenBlocks.find(b => b.episodeNumber === targetEpisodeNumber);
  if (!targetInRewritten) {
    return {
      ok: false,
      merged_content: originalContent,
      episodes_preserved: originalBlocks.length,
      episodes_corrected: 0,
      episodes_missing: [targetEpisodeNumber],
      target_episode_found: false,
      reason: `target_episode_${targetEpisodeNumber}_not_in_rewritten_output`,
    };
  }

  // Build replacement map: only the target episode from rewritten output
  const replacements: Record<number, string> = {
    [targetEpisodeNumber]: targetInRewritten.rawBlock,
  };

  // Use mergeEpisodeBlocks to deterministically merge
  const mergeResult = mergeEpisodeBlocks(originalContent, replacements);

  // Validate the merge
  const validation = validateEpisodeMerge(
    originalContent,
    mergeResult.mergedText,
    [targetEpisodeNumber],
  );

  return {
    ok: validation.ok,
    merged_content: mergeResult.mergedText,
    episodes_preserved: mergeResult.preservedEpisodes.length,
    episodes_corrected: validation.mutatedUntouchedEpisodes.length,
    episodes_missing: validation.missingEpisodes,
    target_episode_found: true,
    reason: validation.ok
      ? `integrity_ok:replaced_ep_${targetEpisodeNumber}:preserved=${mergeResult.preservedEpisodes.length}`
      : `integrity_issues:${validation.errors.join("; ")}`,
  };
}
