/**
 * Deliverable Section Registry — Phase 2D
 *
 * Deterministic section-addressing for supported document types.
 * Defines stable section keys, matching rules, and repair modes
 * per doc type so the system can target partial rewrites instead
 * of full-document regeneration.
 *
 * Architecture:
 *  - Each doc type has zero or more registered sections.
 *  - Each section has a deterministic match mode (heading_exact, heading_regex, slot_path).
 *  - Section repair can be: replace_section, regenerate_section, append_missing_section.
 *  - If a section cannot be resolved, fail closed to full_doc_fallback.
 *  - Doc types without a registry entry always use full_doc_fallback.
 */

// ── Types ──

export type MatchMode = "heading_exact" | "heading_regex" | "slot_path";
export type SectionRepairMode = "replace_section" | "regenerate_section" | "append_missing_section";
export type FallbackMode = "full_doc_rewrite" | "skip";

export interface SectionDefinition {
  /** Stable key for this section, e.g. "protagonists", "act_1_setup" */
  section_key: string;
  /** Human-readable label */
  label: string;
  /** How to locate this section in the document text */
  match_mode: MatchMode;
  /**
   * Pattern used by the match_mode:
   *  - heading_exact: exact heading text (case-insensitive)
   *  - heading_regex: regex pattern string
   *  - slot_path: JSON path or structured key
   */
  match_pattern: string;
  /** Whether this section supports partial rewrite */
  allows_partial_rewrite: boolean;
  /** Default repair mode when targeting this section */
  repair_mode: SectionRepairMode;
  /** Order index for section ordering (used for reconstruction) */
  order: number;
}

export interface DocTypeSectionConfig {
  doc_type: string;
  /** Whether this doc type has section-level repair support */
  section_repair_supported: boolean;
  /** Sections registered for this doc type */
  sections: SectionDefinition[];
  /** Fallback when section targeting fails or is unsupported */
  fallback_mode: FallbackMode;
  /** Minimum section count required for section repair to activate */
  min_sections_required: number;
}

// ── Registry Data ──

const CONCEPT_BRIEF_SECTIONS: SectionDefinition[] = [
  { section_key: "logline", label: "Logline", match_mode: "heading_regex", match_pattern: "^#+\\s*logline", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  { section_key: "premise", label: "Premise", match_mode: "heading_regex", match_pattern: "^#+\\s*premise", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  { section_key: "protagonist", label: "Protagonist", match_mode: "heading_regex", match_pattern: "^#+\\s*protagonist", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "central_conflict", label: "Central Conflict", match_mode: "heading_regex", match_pattern: "^#+\\s*central\\s*conflict", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
  { section_key: "tone_and_style", label: "Tone & Style", match_mode: "heading_regex", match_pattern: "^#+\\s*tone", allows_partial_rewrite: true, repair_mode: "replace_section", order: 4 },
  { section_key: "audience", label: "Audience", match_mode: "heading_regex", match_pattern: "^#+\\s*audience|^#+\\s*target\\s*audience", allows_partial_rewrite: true, repair_mode: "replace_section", order: 5 },
  { section_key: "unique_hook", label: "Unique Hook", match_mode: "heading_regex", match_pattern: "^#+\\s*unique\\s*hook|^#+\\s*hook|^#+\\s*usp", allows_partial_rewrite: true, repair_mode: "replace_section", order: 6 },
];

const FORMAT_RULES_SECTIONS: SectionDefinition[] = [
  { section_key: "format_overview", label: "Format Overview", match_mode: "heading_regex", match_pattern: "^#+\\s*format\\s*(overview|summary)", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  { section_key: "episode_structure", label: "Episode Structure", match_mode: "heading_regex", match_pattern: "^#+\\s*episode\\s*structure", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  { section_key: "runtime", label: "Runtime", match_mode: "heading_regex", match_pattern: "^#+\\s*runtime|^#+\\s*duration", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "tone_rules", label: "Tone Rules", match_mode: "heading_regex", match_pattern: "^#+\\s*tone\\s*rules|^#+\\s*tone\\s*&\\s*style\\s*rules", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
  { section_key: "structural_constraints", label: "Structural Constraints", match_mode: "heading_regex", match_pattern: "^#+\\s*structural\\s*constraints|^#+\\s*constraints", allows_partial_rewrite: true, repair_mode: "replace_section", order: 4 },
];

const CHARACTER_BIBLE_SECTIONS: SectionDefinition[] = [
  // NIT v2.2: added `^#+\s*character\s*group[:\s]+protagonists?` to match generated
  //   format "# CHARACTER GROUP: Protagonists" alongside bare "## Protagonists".
  { section_key: "protagonists", label: "Protagonists", match_mode: "heading_regex", match_pattern: "^#+\\s*protagonists?|^#+\\s*character\\s*group[:\\s]+protagonists?", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  // NIT v2.2: added `^#+\s*character\s*group[:\s]+antagonists?` to match generated
  //   format "# CHARACTER GROUP: Antagonists".
  { section_key: "antagonists", label: "Antagonists", match_mode: "heading_regex", match_pattern: "^#+\\s*antagonists?|^#+\\s*character\\s*group[:\\s]+antagonists?", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  // NIT v2.2: added `^#+\s*character\s*group[:\s]+supporting` to match generated
  //   format "# CHARACTER GROUP: Supporting Characters" (not "Supporting Cast").
  { section_key: "supporting_cast", label: "Supporting Cast", match_mode: "heading_regex", match_pattern: "^#+\\s*supporting\\s*cast|^#+\\s*supporting\\s*characters|^#+\\s*character\\s*group[:\\s]+supporting", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "relationships", label: "Relationships & Dynamics", match_mode: "heading_regex", match_pattern: "^#+\\s*relationships|^#+\\s*dynamics|^#+\\s*relationships\\s*(&|and)\\s*dynamics", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
  { section_key: "character_arcs", label: "Character Arcs", match_mode: "heading_regex", match_pattern: "^#+\\s*character\\s*arcs?|^#+\\s*arcs?", allows_partial_rewrite: true, repair_mode: "replace_section", order: 4 },
];

const SEASON_ARC_SECTIONS: SectionDefinition[] = [
  { section_key: "season_premise", label: "Season Premise", match_mode: "heading_regex", match_pattern: "^#+\\s*season\\s*premise|^#+\\s*premise", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  { section_key: "arc_overview", label: "Arc Overview", match_mode: "heading_regex", match_pattern: "^#+\\s*arc\\s*overview|^#+\\s*season\\s*arc|^#+\\s*overall\\s*arc", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  { section_key: "turning_points", label: "Turning Points", match_mode: "heading_regex", match_pattern: "^#+\\s*turning\\s*points?|^#+\\s*key\\s*turning\\s*points?|^#+\\s*milestones", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "character_season_arcs", label: "Character Season Arcs", match_mode: "heading_regex", match_pattern: "^#+\\s*character\\s*(season\\s*)?arcs?", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
  { section_key: "thematic_throughline", label: "Thematic Throughline", match_mode: "heading_regex", match_pattern: "^#+\\s*thematic|^#+\\s*themes?", allows_partial_rewrite: true, repair_mode: "replace_section", order: 4 },
  { section_key: "season_finale", label: "Season Finale", match_mode: "heading_regex", match_pattern: "^#+\\s*(season\\s*)?finale|^#+\\s*climax|^#+\\s*resolution", allows_partial_rewrite: true, repair_mode: "replace_section", order: 5 },
];

const TREATMENT_SECTIONS: SectionDefinition[] = [
  { section_key: "act_1_setup", label: "Act 1 – Setup", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(1|one|i)\\b|^#+\\s*setup", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  { section_key: "act_2a_rising_action", label: "Act 2A – Rising Action", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(2a|two\\s*a|ii\\s*a)\\b|^#+\\s*rising\\s*action", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  { section_key: "act_2b_complications", label: "Act 2B – Complications", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(2b|two\\s*b|ii\\s*b)\\b|^#+\\s*complications?|^#+\\s*midpoint", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "act_3_climax_resolution", label: "Act 3 – Climax & Resolution", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(3|three|iii)\\b|^#+\\s*climax|^#+\\s*resolution", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
];

const STORY_OUTLINE_SECTIONS: SectionDefinition[] = [
  { section_key: "setup", label: "Setup / Opening", match_mode: "heading_regex", match_pattern: "^#+\\s*setup|^#+\\s*opening|^#+\\s*act\\s*(1|one|i)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  { section_key: "inciting_incident", label: "Inciting Incident", match_mode: "heading_regex", match_pattern: "^#+\\s*inciting\\s*incident|^#+\\s*catalyst", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  { section_key: "rising_action", label: "Rising Action", match_mode: "heading_regex", match_pattern: "^#+\\s*rising\\s*action|^#+\\s*act\\s*(2|two|ii)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "midpoint", label: "Midpoint", match_mode: "heading_regex", match_pattern: "^#+\\s*midpoint|^#+\\s*mid-?point", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
  { section_key: "climax", label: "Climax", match_mode: "heading_regex", match_pattern: "^#+\\s*climax", allows_partial_rewrite: true, repair_mode: "replace_section", order: 4 },
  { section_key: "resolution", label: "Resolution / Denouement", match_mode: "heading_regex", match_pattern: "^#+\\s*resolution|^#+\\s*denouement|^#+\\s*act\\s*(3|three|iii)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 5 },
];

const BEAT_SHEET_SECTIONS: SectionDefinition[] = [
  { section_key: "act_1_beats", label: "Act 1 Beats", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(1|one|i)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 0 },
  { section_key: "act_2a_beats", label: "Act 2A Beats", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(2a|two\\s*a|ii\\s*a)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 1 },
  { section_key: "act_2b_beats", label: "Act 2B Beats", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(2b|two\\s*b|ii\\s*b)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 2 },
  { section_key: "act_3_beats", label: "Act 3 Beats", match_mode: "heading_regex", match_pattern: "^#+\\s*act\\s*(3|three|iii)\\b", allows_partial_rewrite: true, repair_mode: "replace_section", order: 3 },
];

// ── Registry Map ──

const SECTION_REGISTRY: Record<string, DocTypeSectionConfig> = {
  concept_brief: {
    doc_type: "concept_brief",
    section_repair_supported: true,
    sections: CONCEPT_BRIEF_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  format_rules: {
    doc_type: "format_rules",
    section_repair_supported: true,
    sections: FORMAT_RULES_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  character_bible: {
    doc_type: "character_bible",
    section_repair_supported: true,
    sections: CHARACTER_BIBLE_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  season_arc: {
    doc_type: "season_arc",
    section_repair_supported: true,
    sections: SEASON_ARC_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  treatment: {
    doc_type: "treatment",
    section_repair_supported: true,
    sections: TREATMENT_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  long_treatment: {
    doc_type: "long_treatment",
    section_repair_supported: true,
    sections: TREATMENT_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  story_outline: {
    doc_type: "story_outline",
    section_repair_supported: true,
    sections: STORY_OUTLINE_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
  beat_sheet: {
    doc_type: "beat_sheet",
    section_repair_supported: true,
    sections: BEAT_SHEET_SECTIONS,
    fallback_mode: "full_doc_rewrite",
    min_sections_required: 2,
  },
};

// ── Public API ──

/**
 * Get section config for a doc type. Returns null if not supported.
 */
export function getSectionConfig(docType: string): DocTypeSectionConfig | null {
  return SECTION_REGISTRY[docType] || null;
}

/**
 * Check whether a doc type supports section-level repair.
 */
export function isSectionRepairSupported(docType: string): boolean {
  return SECTION_REGISTRY[docType]?.section_repair_supported === true;
}

/**
 * Get all section keys for a doc type.
 */
export function getSectionKeys(docType: string): string[] {
  const config = SECTION_REGISTRY[docType];
  if (!config) return [];
  return config.sections.map(s => s.section_key);
}

/**
 * Find section definition by key within a doc type.
 */
export function findSectionDef(docType: string, sectionKey: string): SectionDefinition | null {
  const config = SECTION_REGISTRY[docType];
  if (!config) return null;
  return config.sections.find(s => s.section_key === sectionKey) || null;
}

/**
 * List all doc types that support section-level repair.
 */
export function listSectionRepairDocTypes(): string[] {
  return Object.keys(SECTION_REGISTRY).filter(k => SECTION_REGISTRY[k].section_repair_supported);
}
