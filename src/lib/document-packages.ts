/**
 * Document Package Definitions
 *
 * Canonical doc_order and required_by_stage for each production type.
 * Used by: Package tab, Finalize & Progress, guardrails enforcement.
 */

export interface DocPackageSpec {
  doc_order: Record<string, number>;
  required_by_stage: Record<string, string[]>;
}

// ─── Feature Film ───

const FEATURE_FILM: DocPackageSpec = {
  doc_order: {
    topline_narrative: 1, idea_brief: 2, logline: 3, one_pager: 4, long_synopsis: 5,
    treatment: 6, character_bible: 7, feature_outline: 8, screenplay_draft: 9,
    budget_topline: 10, finance_plan: 11, packaging_targets: 12,
    production_plan: 13, delivery_requirements: 14,
  },
  required_by_stage: {
    development: ["topline_narrative", "idea_brief", "logline", "one_pager", "long_synopsis", "treatment", "character_bible", "feature_outline"],
    packaging: ["screenplay_draft", "budget_topline", "packaging_targets"],
    pre_production: ["finance_plan", "production_plan"],
    production: [],
    post_production: [],
    sales_delivery: ["delivery_requirements"],
  },
};

// ─── TV Series ───

const TV_SERIES: DocPackageSpec = {
  doc_order: {
    topline_narrative: 1, idea_brief: 2, logline: 3, series_overview: 4, season_arc: 5,
    episode_grid: 6, character_bible: 7, pilot_outline: 8, pilot_script: 9,
    future_seasons_map: 10, budget_topline: 11, finance_plan: 12,
    packaging_targets: 13, sales_distribution_strategy: 14,
    production_plan: 15, delivery_requirements: 16,
  },
  required_by_stage: {
    development: ["topline_narrative", "idea_brief", "logline", "series_overview", "season_arc", "episode_grid", "character_bible", "pilot_outline"],
    packaging: ["pilot_script", "budget_topline", "packaging_targets"],
    pre_production: ["finance_plan", "production_plan", "future_seasons_map"],
    production: [],
    post_production: [],
    sales_delivery: ["sales_distribution_strategy", "delivery_requirements"],
  },
};

// ─── Vertical Drama ───

const VERTICAL_DRAMA: DocPackageSpec = {
  doc_order: {
    topline_narrative: 1, idea: 2, concept_brief: 3, vertical_market_sheet: 4, format_rules: 5,
    character_bible: 6, season_arc: 7, episode_grid: 8,
    vertical_episode_beats: 9, script: 10,
    budget_topline: 11, release_strategy: 12,
    production_plan: 13, delivery_requirements: 14,
  },
  required_by_stage: {
    development: ["topline_narrative", "idea", "concept_brief", "vertical_market_sheet", "format_rules", "character_bible", "season_arc", "episode_grid", "vertical_episode_beats"],
    packaging: ["script", "budget_topline"],
    pre_production: ["production_plan", "release_strategy"],
    production: [],
    post_production: [],
    sales_delivery: ["delivery_requirements"],
  },
};

// ─── Documentary ───

const DOCUMENTARY: DocPackageSpec = {
  doc_order: {
    topline_narrative: 1, doc_premise_brief: 2, logline: 3, one_pager: 4, research_dossier: 5,
    contributors_list: 6, story_arc_plan: 7, shoot_plan: 8,
    ethical_risk_notes: 9, budget_topline: 10, finance_plan: 11,
    distribution_targets: 12, delivery_requirements: 13,
  },
  required_by_stage: {
    development: ["topline_narrative", "doc_premise_brief", "logline", "one_pager", "research_dossier", "story_arc_plan"],
    packaging: ["contributors_list", "budget_topline"],
    pre_production: ["shoot_plan", "ethical_risk_notes", "finance_plan"],
    production: [],
    post_production: [],
    sales_delivery: ["distribution_targets", "delivery_requirements"],
  },
};

// ─── Commercial / Advert ───

const COMMERCIAL_ADVERT: DocPackageSpec = {
  doc_order: {
    creative_brief: 1, concept_routes: 2, script_or_boards: 3,
    shot_list: 4, production_plan: 5, budget_topline: 6,
    usage_rights_assumptions: 7, delivery_requirements: 8,
  },
  required_by_stage: {
    development: ["creative_brief", "concept_routes", "script_or_boards"],
    packaging: ["shot_list", "budget_topline"],
    pre_production: ["production_plan", "usage_rights_assumptions"],
    production: [],
    post_production: [],
    sales_delivery: ["delivery_requirements"],
  },
};

// ─── Branded Content ───

const BRANDED_CONTENT: DocPackageSpec = {
  doc_order: {
    brand_creative_brief: 1, concept: 2, treatment: 3,
    script_or_outline: 4, production_plan: 5, budget_topline: 6,
    distribution_plan: 7, delivery_requirements: 8,
  },
  required_by_stage: {
    development: ["brand_creative_brief", "concept", "treatment"],
    packaging: ["script_or_outline", "budget_topline"],
    pre_production: ["production_plan"],
    production: [],
    post_production: [],
    sales_delivery: ["distribution_plan", "delivery_requirements"],
  },
};

// ─── Short Film ───

const SHORT_FILM: DocPackageSpec = {
  doc_order: {
    logline: 1, one_pager: 2, short_script: 3,
    character_bible_light: 4, budget_topline: 5, production_plan: 6,
  },
  required_by_stage: {
    development: ["logline", "one_pager", "short_script", "character_bible_light"],
    packaging: ["budget_topline"],
    pre_production: ["production_plan"],
    production: [],
    post_production: [],
    sales_delivery: [],
  },
};

// ─── Digital Series ───

const DIGITAL_SERIES: DocPackageSpec = {
  doc_order: {
    format_rules: 1, series_overview: 2, episode_grid: 3,
    host_or_character_bible: 4, pilot_run_of_show: 5,
    production_plan: 6, budget_topline: 7,
    distribution_strategy: 8, delivery_requirements: 9,
  },
  required_by_stage: {
    development: ["format_rules", "series_overview", "episode_grid", "host_or_character_bible"],
    packaging: ["pilot_run_of_show", "budget_topline"],
    pre_production: ["production_plan"],
    production: [],
    post_production: [],
    sales_delivery: ["distribution_strategy", "delivery_requirements"],
  },
};

// ─── Registry ───

export const DOCUMENT_PACKAGES: Record<string, DocPackageSpec> = {
  film: FEATURE_FILM,
  "feature-film": FEATURE_FILM,
  "narrative-feature": FEATURE_FILM,
  "tv-series": TV_SERIES,
  "limited-series": TV_SERIES,
  "vertical-drama": VERTICAL_DRAMA,
  documentary: DOCUMENTARY,
  "documentary-series": DOCUMENTARY,
  "anim-feature": FEATURE_FILM,
  "anim-series": TV_SERIES,
  commercial: COMMERCIAL_ADVERT,
  "commercial-advert": COMMERCIAL_ADVERT,
  "branded-content": BRANDED_CONTENT,
  "short-film": SHORT_FILM,
  "digital-series": DIGITAL_SERIES,
  reality: TV_SERIES,
};

/**
 * Get doc package for a production type (normalised).
 * Falls back to Feature Film if unknown.
 */
export function getDocPackage(productionType: string | null | undefined): DocPackageSpec {
  const key = (productionType || "film").toLowerCase().replace(/[_ ]+/g, "-");
  return DOCUMENT_PACKAGES[key] || FEATURE_FILM;
}

/**
 * Get all doc types in order for a production type.
 */
export function getOrderedDocTypes(productionType: string | null | undefined): string[] {
  const pkg = getDocPackage(productionType);
  return Object.entries(pkg.doc_order)
    .sort(([, a], [, b]) => a - b)
    .map(([docType]) => docType);
}

/**
 * Get required doc types for a given stage.
 * Returns cumulative requirements (all stages up to and including current).
 */
export function getRequiredDocsForStage(
  productionType: string | null | undefined,
  stage: string
): string[] {
  const pkg = getDocPackage(productionType);
  const stageOrder = ["development", "packaging", "pre_production", "production", "post_production", "sales_delivery"];
  const stageIdx = stageOrder.indexOf(stage.toLowerCase().replace(/[- ]+/g, "_"));
  if (stageIdx < 0) return [];

  const required = new Set<string>();
  for (let i = 0; i <= stageIdx; i++) {
    const docs = pkg.required_by_stage[stageOrder[i]] || [];
    docs.forEach(d => required.add(d));
  }
  return [...required];
}

/**
 * Format a doc_type into human-readable text.
 */
export function formatDocType(docType: string): string {
  return docType
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Get zero-padded order prefix for export path.
 */
export function getDocOrderPrefix(productionType: string | null | undefined, docType: string): string {
  const pkg = getDocPackage(productionType);
  const order = pkg.doc_order[docType] ?? 99;
  return String(order).padStart(2, "0");
}
