/**
 * Large-Risk Document Router — Single Source of Truth
 *
 * Determines whether a doc_type is "large-risk" (prone to LLM summarization)
 * and provides the correct chunking strategy + chunk plan.
 *
 * Used by: generate-document, dev-engine-v2, auto-run.
 * ALL generation/rewrite paths MUST consult this before single-pass operations.
 */

// ── Strategy Types ──

export type ChunkStrategy = "episodic_indexed" | "sectioned" | "scene_indexed";

export interface ChunkPlanEntry {
  chunkIndex: number;
  chunkKey: string;
  /** For episodic: episode range. For sectioned: section name. */
  label: string;
  /** For episodic: start episode (inclusive) */
  episodeStart?: number;
  /** For episodic: end episode (inclusive) */
  episodeEnd?: number;
  /** For sectioned: section identifier */
  sectionId?: string;
}

export interface ChunkPlan {
  strategy: ChunkStrategy;
  chunks: ChunkPlanEntry[];
  totalChunks: number;
  docType: string;
  /** For episodic: total episode count */
  episodeCount?: number;
}

// ── Large-Risk Doc Type Registry ──

const EPISODIC_DOC_TYPES = new Set([
  "episode_grid",
  "episode_beats",
  "vertical_episode_beats",
  "episode_script",
  "season_scripts_bundle",
  "season_master_script",
]);

const SECTIONED_DOC_TYPES = new Set([
  "feature_script",
  "screenplay_draft",
  "long_treatment",
  "treatment",
  "character_bible",
  "long_character_bible",
]);

const SCENE_INDEXED_DOC_TYPES = new Set([
  "production_draft",
]);

const ALL_LARGE_RISK = new Set([
  ...EPISODIC_DOC_TYPES,
  ...SECTIONED_DOC_TYPES,
  ...SCENE_INDEXED_DOC_TYPES,
]);

// ── Public API ──

/**
 * Returns true if this doc_type is large-risk and MUST use chunked generation/rewrite.
 * Single-pass LLM calls are NEVER allowed for these types.
 */
export function isLargeRiskDocType(docType: string): boolean {
  return ALL_LARGE_RISK.has(docType);
}

/**
 * Returns the chunking strategy for a doc_type.
 * Throws if the doc_type is not large-risk.
 */
export function strategyFor(docType: string): ChunkStrategy {
  if (EPISODIC_DOC_TYPES.has(docType)) return "episodic_indexed";
  if (SECTIONED_DOC_TYPES.has(docType)) return "sectioned";
  if (SCENE_INDEXED_DOC_TYPES.has(docType)) return "scene_indexed";
  throw new Error(`[largeRiskRouter] ${docType} is not a large-risk doc type`);
}

/**
 * Default episodes per chunk for episodic doc types.
 * Configurable per lane in the future.
 */
const DEFAULT_EPISODIC_BATCH_SIZE = 5;

/**
 * Default sections for non-episodic large-risk docs.
 */
const TREATMENT_SECTIONS = [
  "act_1_setup",
  "act_2a_rising_action",
  "act_2b_complications",
  "act_3_climax_resolution",
];

const SCRIPT_SECTIONS = [
  "act_1",
  "act_2a",
  "act_2b",
  "act_3",
];

const CHARACTER_BIBLE_SECTIONS = [
  "protagonists",
  "antagonists",
  "supporting_cast",
  "relationships_and_dynamics",
];

/**
 * Build a deterministic chunk plan for a large-risk doc type.
 *
 * @param docType - the document type
 * @param context - project context needed to build the plan
 * @returns ChunkPlan with ordered chunk entries
 */
export function chunkPlanFor(
  docType: string,
  context: {
    episodeCount?: number | null;
    sceneCount?: number | null;
    batchSize?: number;
  } = {}
): ChunkPlan {
  const strategy = strategyFor(docType);

  if (strategy === "episodic_indexed") {
    const episodeCount = context.episodeCount;
    if (!episodeCount || episodeCount < 1) {
      throw new Error(
        `[largeRiskRouter] episodic doc type "${docType}" requires episodeCount > 0, got ${episodeCount}`
      );
    }

    const batchSize = context.batchSize || DEFAULT_EPISODIC_BATCH_SIZE;
    const chunks: ChunkPlanEntry[] = [];
    let chunkIndex = 0;

    for (let start = 1; start <= episodeCount; start += batchSize) {
      const end = Math.min(start + batchSize - 1, episodeCount);
      chunks.push({
        chunkIndex,
        chunkKey: `E${String(start).padStart(2, "0")}-E${String(end).padStart(2, "0")}`,
        label: `Episodes ${start}–${end}`,
        episodeStart: start,
        episodeEnd: end,
      });
      chunkIndex++;
    }

    return { strategy, chunks, totalChunks: chunks.length, docType, episodeCount };
  }

  if (strategy === "sectioned") {
    let sections: string[];
    if (docType === "treatment" || docType === "long_treatment") {
      sections = TREATMENT_SECTIONS;
    } else if (docType === "character_bible" || docType === "long_character_bible") {
      sections = CHARACTER_BIBLE_SECTIONS;
    } else {
      // Scripts: act-based
      sections = SCRIPT_SECTIONS;
    }

    const chunks: ChunkPlanEntry[] = sections.map((sec, i) => ({
      chunkIndex: i,
      chunkKey: sec,
      label: sec.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      sectionId: sec,
    }));

    return { strategy, chunks, totalChunks: chunks.length, docType };
  }

  if (strategy === "scene_indexed") {
    if (!context.sceneCount || context.sceneCount < 1) {
      // Fall back to sectioned strategy if no real scene count from DB
      console.warn(`[largeRiskRouter] scene_indexed requested for "${docType}" but no sceneCount — falling back to sectioned`);
      const sections = SCRIPT_SECTIONS;
      const chunks: ChunkPlanEntry[] = sections.map((sec, i) => ({
        chunkIndex: i,
        chunkKey: sec,
        label: sec.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        sectionId: sec,
      }));
      return { strategy: "sectioned", chunks, totalChunks: chunks.length, docType };
    }

    const sceneCount = context.sceneCount;
    const batchSize = context.batchSize || 5;
    const chunks: ChunkPlanEntry[] = [];
    let chunkIndex = 0;

    for (let start = 1; start <= sceneCount; start += batchSize) {
      const end = Math.min(start + batchSize - 1, sceneCount);
      chunks.push({
        chunkIndex,
        chunkKey: `SC${String(start).padStart(2, "0")}-SC${String(end).padStart(2, "0")}`,
        label: `Scenes ${start}–${end}`,
      });
      chunkIndex++;
    }

    return { strategy: "scene_indexed", chunks, totalChunks: chunks.length, docType };
  }

  throw new Error(`[largeRiskRouter] Unknown strategy: ${strategy}`);
}

/**
 * Check if a doc_type is episodic (requires episode count).
 */
export function isEpisodicDocType(docType: string): boolean {
  return EPISODIC_DOC_TYPES.has(docType);
}
