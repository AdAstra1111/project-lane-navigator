/**
 * Document Policy Registry v1
 * Classifies doc types and provides acceptance profiles for the convergence engine.
 * Used by auto-run and (later) doc-os / NUE.
 *
 * INVARIANT: Unknown doc types FAIL CLOSED — no silent defaults.
 */

// ── Doc Class ──
export type DocClass = "UNIT" | "SINGLE" | "AGGREGATE" | "UNKNOWN";

export interface DocPolicy {
  docClass: DocClass;
  /** UNIT docs require meta_json.episode_index for slot identification */
  requiresEpisodeIndex?: boolean;
  /** Acceptance profile key for convergence thresholds */
  acceptanceProfile: string;
}

// ── Acceptance Profiles ──
export interface AcceptanceProfile {
  regressionThreshold: number;   // PROMOTE_DELTA: max drop to auto-promote to is_current
  exploreThreshold: number;      // EXPLORE_DELTA: max drop to continue exploring (without promoting)
  maxFrontierAttempts: number;   // bounded frontier exploration attempts
  minCI: number;
  minGP: number;
}

export const ACCEPTANCE_PROFILES: Record<string, AcceptanceProfile> = {
  UNIT_PROFILE_DEFAULT:   { regressionThreshold: 5, exploreThreshold: 15, maxFrontierAttempts: 3, minCI: 0, minGP: 0 },
  SINGLE_PROFILE_DEFAULT: { regressionThreshold: 5, exploreThreshold: 15, maxFrontierAttempts: 3, minCI: 0, minGP: 0 },
  AGG_PROFILE_DEFAULT:    { regressionThreshold: 0, exploreThreshold: 0,  maxFrontierAttempts: 0, minCI: 0, minGP: 0 },
};

// ── Registry ──
const REGISTRY: Record<string, DocPolicy> = {
  // UNIT docs (per-episode)
  episode_outline:  { docClass: "UNIT", requiresEpisodeIndex: true, acceptanceProfile: "UNIT_PROFILE_DEFAULT" },
  episode_script:   { docClass: "UNIT", requiresEpisodeIndex: true, acceptanceProfile: "UNIT_PROFILE_DEFAULT" },

  // SINGLE docs — every ladder doc type must be registered here
  concept_brief:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  logline:          { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  idea:             { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  treatment:        { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  story_outline:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  character_bible:  { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  feature_script:   { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  beat_sheet:       { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  production_draft: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  blueprint:        { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  script:           { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  deck:             { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  market_sheet:     { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  season_arc:       { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  format_rules:     { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  documentary_outline: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  vertical_episode_beats: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  vertical_market_sheet: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  // PATCH 1: season_script + episode_beats — previously missing, caused DOC_TYPE_UNREGISTERED halts
  season_script:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  episode_beats:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  // Seed / support doc types that auto-run may encounter
  project_overview: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  creative_brief:   { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  market_positioning: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  canon:            { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  nec:              { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },

  // AGGREGATE docs (compile-only — no LLM rewrites)
  episode_grid:           { docClass: "AGGREGATE", acceptanceProfile: "AGG_PROFILE_DEFAULT" },
  season_master_script:   { docClass: "AGGREGATE", acceptanceProfile: "AGG_PROFILE_DEFAULT" },
};

/**
 * Soft lookup — returns UNKNOWN policy for unregistered types.
 * Use requireDocPolicy() for write paths that must fail closed.
 */
export function getDocPolicy(docType: string): DocPolicy & { registered: boolean } {
  const p = REGISTRY[docType];
  if (p) return { ...p, registered: true };
  return { docClass: "UNKNOWN", acceptanceProfile: "SINGLE_PROFILE_DEFAULT", registered: false };
}

/**
 * FAIL-CLOSED lookup — throws if doc type is not in registry.
 * Must be used on all write/rewrite paths.
 */
export function requireDocPolicy(docType: string): DocPolicy {
  const p = REGISTRY[docType];
  if (!p) throw new Error(`DOC_TYPE_UNREGISTERED:${docType}`);
  return p;
}

/**
 * Check if doc type is AGGREGATE (compile-only). Uses docClass, not compileOnly flag.
 * Throws if doc type is unregistered.
 */
export function isAggregate(docType: string): boolean {
  return requireDocPolicy(docType).docClass === "AGGREGATE";
}

export function getRegressionThreshold(docType: string): number {
  const policy = requireDocPolicy(docType);
  const profile = ACCEPTANCE_PROFILES[policy.acceptanceProfile];
  return profile?.regressionThreshold ?? 5;
}

export function getExploreThreshold(docType: string): number {
  const policy = requireDocPolicy(docType);
  const profile = ACCEPTANCE_PROFILES[policy.acceptanceProfile];
  return profile?.exploreThreshold ?? 15;
}

export function getMaxFrontierAttempts(docType: string): number {
  const policy = requireDocPolicy(docType);
  const profile = ACCEPTANCE_PROFILES[policy.acceptanceProfile];
  return profile?.maxFrontierAttempts ?? 3;
}

/**
 * PATCH 1b: Ladder integrity validator.
 * Validates all doc_types in a format ladder are registered in the policy registry.
 * Returns { valid: true } or { valid: false, missing: string[] }.
 */
export function validateLadderIntegrity(ladder: string[]): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const docType of ladder) {
    if (!REGISTRY[docType]) {
      missing.push(docType);
    }
  }
  return { valid: missing.length === 0, missing };
}

/**
 * PATCH 4: Deterministic canon alignment validator.
 * Validates generated content contains expected entities from canon sources.
 * Returns { pass: boolean, entityCoverage: number, foreignEntities: string[] }.
 */
export function validateCanonAlignment(
  generatedText: string,
  canonEntities: string[],
  opts: { minCoverage?: number; maxForeignRatio?: number } = {}
): { pass: boolean; entityCoverage: number; matchedEntities: string[]; missingEntities: string[]; foreignEntities: string[]; reason?: string } {
  const minCoverage = opts.minCoverage ?? 0.6;
  const maxForeignRatio = opts.maxForeignRatio ?? 0.5;

  if (!canonEntities.length) {
    return { pass: true, entityCoverage: 1, matchedEntities: [], missingEntities: [], foreignEntities: [], reason: "no_canon_entities" };
  }

  const textLower = generatedText.toLowerCase();
  const matched: string[] = [];
  const missing: string[] = [];

  for (const entity of canonEntities) {
    if (!entity || entity.length < 2) continue;
    if (textLower.includes(entity.toLowerCase())) {
      matched.push(entity);
    } else {
      missing.push(entity);
    }
  }

  const coverage = matched.length / canonEntities.length;

  // Extract capitalized multi-word names from generated text (simple heuristic)
  const namePattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  const foundNames = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(generatedText)) !== null) {
    foundNames.add(match[0]);
  }

  // Filter out canon entities to find foreign ones
  const canonLower = new Set(canonEntities.map(e => e.toLowerCase()));
  const foreign: string[] = [];
  for (const name of foundNames) {
    if (!canonLower.has(name.toLowerCase())) {
      foreign.push(name);
    }
  }

  const foreignRatio = foundNames.size > 0 ? foreign.length / foundNames.size : 0;

  const pass = coverage >= minCoverage && foreignRatio <= maxForeignRatio;

  return {
    pass,
    entityCoverage: Math.round(coverage * 100) / 100,
    matchedEntities: matched,
    missingEntities: missing,
    foreignEntities: foreign,
    reason: !pass
      ? (coverage < minCoverage ? `entity_coverage_${Math.round(coverage * 100)}%_below_${Math.round(minCoverage * 100)}%` : `foreign_entity_ratio_${Math.round(foreignRatio * 100)}%_above_${Math.round(maxForeignRatio * 100)}%`)
      : undefined,
  };
}
