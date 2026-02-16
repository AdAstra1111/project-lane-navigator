/**
 * Document Dependency Map
 * 
 * Defines which canonical qualification fields each doc_type depends on.
 * Used by generate-document to set depends_on, and by staleness detection.
 */

// Fields that doc types depend on from resolvedQualifications
export const DOC_DEPENDENCY_MAP: Record<string, string[]> = {
  // Series / Vertical docs — depend on episode count + duration
  pitch_document: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  season_arc: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  episode_grid: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  series_overview: ["qualifications.season_episode_count"],
  format_rules: ["qualifications.episode_target_duration_seconds"],
  pilot_script: ["qualifications.episode_target_duration_seconds"],
  pilot_outline: ["qualifications.episode_target_duration_seconds"],
  season_scripts_bundle: ["qualifications.season_episode_count", "qualifications.episode_target_duration_seconds"],
  future_seasons_map: ["qualifications.season_episode_count"],
  pilot_run_of_show: ["qualifications.episode_target_duration_seconds"],

  // Character bibles in series context
  character_bible: ["qualifications.season_episode_count"],
  host_or_character_bible: ["qualifications.season_episode_count"],

  // Film docs — depend on runtime
  feature_outline: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],
  screenplay_draft: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],
  long_synopsis: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],
  short_script: ["qualifications.target_runtime_min_low", "qualifications.target_runtime_min_high"],

  // General docs — no qualification dependency by default
  idea_brief: [],
  logline: [],
  one_pager: [],
  treatment: [],
  budget_topline: [],
  finance_plan: [],
  packaging_targets: [],
  production_plan: [],
  delivery_requirements: [],
  creative_brief: [],
  concept_routes: [],
  script_or_boards: [],
  shot_list: [],
  usage_rights_assumptions: [],
  brand_creative_brief: [],
  concept: [],
  script_or_outline: [],
  distribution_plan: [],
  distribution_strategy: [],
  distribution_targets: [],
  sales_distribution_strategy: [],
  release_strategy: [],
  doc_premise_brief: [],
  research_dossier: [],
  contributors_list: [],
  story_arc_plan: [],
  shoot_plan: [],
  ethical_risk_notes: [],
  character_bible_light: [],
};

/**
 * Get the depends_on list for a doc type.
 * Returns empty array for unknown doc types.
 */
export function getDocDependencies(docType: string): string[] {
  return DOC_DEPENDENCY_MAP[docType] || [];
}

/**
 * Check if a doc type has qualification dependencies.
 */
export function hasQualificationDependency(docType: string): boolean {
  const deps = DOC_DEPENDENCY_MAP[docType];
  return !!deps && deps.length > 0;
}

/**
 * Given a list of changed fields, return which doc types are affected.
 */
export function getAffectedDocTypes(changedFields: string[]): string[] {
  const affected: string[] = [];
  for (const [docType, deps] of Object.entries(DOC_DEPENDENCY_MAP)) {
    if (deps.some(dep => changedFields.includes(dep))) {
      affected.push(docType);
    }
  }
  return affected;
}
