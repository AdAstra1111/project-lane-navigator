/**
 * Deterministic Deferral Policy Registry
 *
 * Single source of truth for classifying workflow decisions as
 * BLOCKING_NOW, DEFERRABLE, or NEVER_BLOCKING.
 *
 * NON-NEGOTIABLE INVARIANTS:
 *   1. No LLM-based classification — all rules are deterministic.
 *   2. Format = product discriminator (maps to canonical stage ladders).
 *   3. Decision keys are stable: `${format}:${doc_type}:${semantic_key}`.
 *   4. Canon decisions (decision_ledger) are NOT managed here.
 *   5. This registry is imported by auto-run and dev-engine-v2.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type DecisionClassification = "BLOCKING_NOW" | "DEFERRABLE" | "NEVER_BLOCKING";

export interface ClassificationResult {
  classification: DecisionClassification;
  reason: string;
  revisit_stage: string | null;
}

export interface DecisionDef {
  question: string;
  options?: Array<{ value: string; label: string }>;
  required_evidence_template: RequiredEvidence[];
  default_revisit_stage: string | null;
}

export interface RequiredEvidence {
  /** Doc type that must exist and be approved before this decision is BLOCKING */
  doc_type: string;
  /** If true, the doc must have approval_status='approved' */
  requires_approval: boolean;
}

export interface ClassificationContext {
  format: string;
  lane: string | null;
  doc_type: string;
  stage_index: number;
  ladder: string[];
  allow_defaults: boolean;
  /** Map of doc_type → { exists: boolean; approved: boolean } */
  approvals_state: Record<string, { exists: boolean; approved: boolean }>;
  /** Whether canon facts exist for key entities */
  canon_state: { has_characters: boolean; has_world_rules: boolean };
}

// ── Semantic Keys ──────────────────────────────────────────────────────────

export const SEMANTIC_KEYS = {
  EPISODE_COUNT: "EPISODE_COUNT",
  CAST_LOCK: "CAST_LOCK",
  TONE_POLARITY: "TONE_POLARITY",
  WORLD_RULE_ANCHOR: "WORLD_RULE_ANCHOR",
  FORMAT_RUNTIME: "FORMAT_RUNTIME",
  CONTRACT_LOGIC: "CONTRACT_LOGIC",
  TENTPOLE_MAPPING: "TENTPOLE_MAPPING",
  QUALITY_PLATEAU: "QUALITY_PLATEAU",
} as const;

// ── Decision Key Builder ───────────────────────────────────────────────────

export function buildDecisionKey(format: string, docType: string, semanticKey: string): string {
  return `${format}:${docType}:${semanticKey}`;
}

// ── Decision Definitions ───────────────────────────────────────────────────

export const DECISION_DEFS: Record<string, DecisionDef> = {
  EPISODE_COUNT: {
    question: "How many episodes should this season contain?",
    options: [
      { value: "8", label: "8 episodes" },
      { value: "10", label: "10 episodes" },
      { value: "12", label: "12 episodes" },
      { value: "24", label: "24 episodes" },
      { value: "35", label: "35 episodes" },
    ],
    required_evidence_template: [
      { doc_type: "concept_brief", requires_approval: false },
    ],
    default_revisit_stage: "season_arc",
  },
  CAST_LOCK: {
    question: "Should the character roster be locked for script generation?",
    required_evidence_template: [
      { doc_type: "character_bible", requires_approval: true },
    ],
    default_revisit_stage: null,
  },
  TONE_POLARITY: {
    question: "What is the dominant tonal register for this project?",
    options: [
      { value: "dark", label: "Dark / Gritty" },
      { value: "warm", label: "Warm / Hopeful" },
      { value: "satirical", label: "Satirical / Ironic" },
      { value: "tense", label: "Tense / Thriller" },
    ],
    required_evidence_template: [
      { doc_type: "treatment", requires_approval: false },
    ],
    default_revisit_stage: "beat_sheet",
  },
  WORLD_RULE_ANCHOR: {
    question: "Are the foundational world rules established and locked?",
    required_evidence_template: [
      { doc_type: "treatment", requires_approval: true },
    ],
    default_revisit_stage: "character_bible",
  },
  FORMAT_RUNTIME: {
    question: "What is the target runtime per episode?",
    options: [
      { value: "60", label: "~1 minute (vertical)" },
      { value: "180", label: "~3 minutes (short-form)" },
      { value: "1800", label: "~30 minutes (half-hour)" },
      { value: "3600", label: "~60 minutes (hour-long)" },
    ],
    required_evidence_template: [
      { doc_type: "format_rules", requires_approval: false },
    ],
    default_revisit_stage: null,
  },
  CONTRACT_LOGIC: {
    question: "Is the central narrative contract/premise logically grounded?",
    required_evidence_template: [
      { doc_type: "story_outline", requires_approval: true },
    ],
    default_revisit_stage: "beat_sheet",
  },
  TENTPOLE_MAPPING: {
    question: "Are the tentpole/anchor episodes confirmed?",
    required_evidence_template: [
      { doc_type: "episode_grid", requires_approval: true },
    ],
    default_revisit_stage: "season_script",
  },
  QUALITY_PLATEAU: {
    question: "Quality scores have plateaued. Should we proceed to the next stage or continue refining?",
    options: [
      { value: "proceed", label: "Proceed to next stage" },
      { value: "continue", label: "Continue refining" },
    ],
    required_evidence_template: [],
    default_revisit_stage: null,
  },
};

// ── Required Decisions by Stage ────────────────────────────────────────────
// Format → doc_type → { blocking: semantic_keys[], deferrable: semantic_keys[] }

type StageDecisionMap = Record<string, { blocking: string[]; deferrable: string[] }>;

const VERTICAL_DRAMA_DECISIONS: StageDecisionMap = {
  format_rules: {
    blocking: ["FORMAT_RUNTIME"],
    deferrable: [],
  },
  character_bible: {
    blocking: ["CAST_LOCK"],
    deferrable: ["TONE_POLARITY"],
  },
  season_arc: {
    blocking: ["EPISODE_COUNT"],
    deferrable: ["TENTPOLE_MAPPING"],
  },
  episode_grid: {
    blocking: [],
    deferrable: ["TENTPOLE_MAPPING"],
  },
  season_script: {
    blocking: ["EPISODE_COUNT", "CAST_LOCK"],
    deferrable: [],
  },
};

const FILM_DECISIONS: StageDecisionMap = {
  treatment: {
    blocking: [],
    deferrable: ["TONE_POLARITY", "WORLD_RULE_ANCHOR"],
  },
  character_bible: {
    blocking: ["CAST_LOCK"],
    deferrable: [],
  },
  beat_sheet: {
    blocking: [],
    deferrable: ["CONTRACT_LOGIC"],
  },
  feature_script: {
    blocking: ["CAST_LOCK", "TONE_POLARITY"],
    deferrable: [],
  },
};

const TV_SERIES_DECISIONS: StageDecisionMap = {
  treatment: {
    blocking: [],
    deferrable: ["TONE_POLARITY", "WORLD_RULE_ANCHOR"],
  },
  character_bible: {
    blocking: ["CAST_LOCK"],
    deferrable: [],
  },
  beat_sheet: {
    blocking: [],
    deferrable: ["CONTRACT_LOGIC"],
  },
  episode_script: {
    blocking: ["EPISODE_COUNT", "CAST_LOCK"],
    deferrable: [],
  },
  season_master_script: {
    blocking: ["EPISODE_COUNT"],
    deferrable: [],
  },
};

export const REQUIRED_DECISIONS_BY_STAGE: Record<string, StageDecisionMap> = {
  "vertical-drama": VERTICAL_DRAMA_DECISIONS,
  "film": FILM_DECISIONS,
  "feature": FILM_DECISIONS,
  "tv-series": TV_SERIES_DECISIONS,
  "limited-series": TV_SERIES_DECISIONS,
  "digital-series": TV_SERIES_DECISIONS,
  "anim-series": TV_SERIES_DECISIONS,
};

// ── Classification Logic ───────────────────────────────────────────────────

/**
 * Classify a decision deterministically.
 *
 * Rules (fail-closed):
 * 1. If semantic_key is not in DECISION_DEFS → NEVER_BLOCKING (unknown key).
 * 2. If evidence is missing → DEFERRABLE (can't decide yet).
 * 3. If evidence exists but decision unresolved → BLOCKING_NOW.
 * 4. QUALITY_PLATEAU is always DEFERRABLE.
 */
export function classifyDecision(
  semanticKey: string,
  ctx: ClassificationContext,
): ClassificationResult {
  const def = DECISION_DEFS[semanticKey];
  if (!def) {
    return {
      classification: "NEVER_BLOCKING",
      reason: `Unknown decision key: ${semanticKey}`,
      revisit_stage: null,
    };
  }

  // Quality plateau is always deferrable
  if (semanticKey === "QUALITY_PLATEAU") {
    return {
      classification: "DEFERRABLE",
      reason: "Quality plateau — proceed to next stage or user decides",
      revisit_stage: getNextStage(ctx.doc_type, ctx.ladder),
    };
  }

  // Check required evidence availability
  const evidenceMissing = def.required_evidence_template.some((ev) => {
    const state = ctx.approvals_state[ev.doc_type];
    if (!state || !state.exists) return true;
    if (ev.requires_approval && !state.approved) return true;
    return false;
  });

  if (evidenceMissing) {
    // Determine revisit stage: earliest stage where evidence becomes available
    const revisitStage = def.default_revisit_stage || getNextStage(ctx.doc_type, ctx.ladder);
    return {
      classification: "DEFERRABLE",
      reason: `Required evidence not yet available (missing upstream docs/approvals)`,
      revisit_stage: revisitStage,
    };
  }

  // Evidence exists but decision unresolved → BLOCKING
  return {
    classification: "BLOCKING_NOW",
    reason: `Required evidence is available but decision has not been made`,
    revisit_stage: null,
  };
}

/**
 * Get required decisions for a given format + doc_type.
 * Returns empty arrays if format/doc_type not in registry (fail-open for unknown combos).
 */
export function getRequiredDecisions(
  format: string,
  docType: string,
): { blocking: string[]; deferrable: string[] } {
  const formatMap = REQUIRED_DECISIONS_BY_STAGE[format];
  if (!formatMap) return { blocking: [], deferrable: [] };
  return formatMap[docType] || { blocking: [], deferrable: [] };
}

/**
 * Build the full decision key for DB storage.
 */
export function buildPendingDecisionKey(format: string, docType: string, semanticKey: string): string {
  return `${format}:${docType}:${semanticKey}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getNextStage(currentDocType: string, ladder: string[]): string | null {
  // Delegate to shared invariant guard — prevents self-loops, reverse progression, unresolved stages
  return getCanonicalNextStage({
    ladder,
    currentStage: currentDocType,
    format: "unknown", // context not available here — ladder already resolved by caller
    source: "decisionPolicyRegistry",
  });
}

/**
 * Quality Plateau Detection.
 *
 * Returns true if CI/GP are high but stagnating.
 * This is a deterministic check — no LLM involved.
 */
export function isQualityPlateau(params: {
  ci: number;
  gp: number;
  previousCi: number;
  previousGp: number;
  consecutiveHighScoreAttempts: number;
}): boolean {
  const { ci, gp, previousCi, previousGp, consecutiveHighScoreAttempts } = params;
  // High scores
  if (ci < 85 || gp < 85) return false;
  // Stagnating (delta < 3 across attempts)
  const ciDelta = Math.abs(ci - previousCi);
  const gpDelta = Math.abs(gp - previousGp);
  if (ciDelta >= 3 || gpDelta >= 3) return false;
  // Multiple attempts at high score without meaningful improvement
  return consecutiveHighScoreAttempts >= 3;
}
