/**
 * Document Policy Registry v1
 * Classifies doc types and provides acceptance profiles for the convergence engine.
 * Used by auto-run and (later) doc-os / NUE.
 */

// ── Doc Class ──
export type DocClass = "UNIT" | "SINGLE" | "AGGREGATE";

export interface DocPolicy {
  docClass: DocClass;
  /** UNIT docs require meta_json.episode_index for slot identification */
  requiresEpisodeIndex?: boolean;
  /** AGGREGATE docs are compile-only — LLM rewrites are forbidden */
  compileOnly?: boolean;
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

  // SINGLE docs
  concept_brief:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  logline:          { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  idea:             { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  treatment:        { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  story_outline:    { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  character_bible:  { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  feature_script:   { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  beat_sheet:       { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },
  production_draft: { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" },

  // AGGREGATE docs (compile-only — no LLM rewrites)
  episode_grid:           { docClass: "AGGREGATE", compileOnly: true, acceptanceProfile: "AGG_PROFILE_DEFAULT" },
  season_master_script:   { docClass: "AGGREGATE", compileOnly: true, acceptanceProfile: "AGG_PROFILE_DEFAULT" },
};

export function getDocPolicy(docType: string): DocPolicy {
  return REGISTRY[docType] || { docClass: "SINGLE", acceptanceProfile: "SINGLE_PROFILE_DEFAULT" };
}

export function isAggregate(docType: string): boolean {
  return getDocPolicy(docType).compileOnly === true;
}

export function getRegressionThreshold(docType: string): number {
  const profile = ACCEPTANCE_PROFILES[getDocPolicy(docType).acceptanceProfile];
  return profile?.regressionThreshold ?? 5;
}
