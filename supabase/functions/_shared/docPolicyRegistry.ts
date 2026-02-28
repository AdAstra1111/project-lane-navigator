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
export const ACCEPTANCE_PROFILES: Record<string, { regressionThreshold: number; minCI: number; minGP: number }> = {
  UNIT_PROFILE_DEFAULT:   { regressionThreshold: 5, minCI: 0, minGP: 0 },
  SINGLE_PROFILE_DEFAULT: { regressionThreshold: 5, minCI: 0, minGP: 0 },
  AGG_PROFILE_DEFAULT:    { regressionThreshold: 0, minCI: 0, minGP: 0 },
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
