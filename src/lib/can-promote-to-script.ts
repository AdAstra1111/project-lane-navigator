/**
 * Canonical doc_type taxonomy — single source of truth.
 * All doc_type classification MUST use these sets. No content-based heuristics.
 */

// ── Canonical doc_type sets ──

export const SCRIPT_DOC_TYPES = new Set([
  'screenplay_draft',
  'pilot_script',
  'episode_script',
  'episodes_1_3_scripts',
  'script',
  'season_scripts_bundle',
]);

export const NON_SCRIPT_DOC_TYPES = new Set([
  'writers_room',
  'notes',
  'topline_narrative',
  'concept_brief',
  'format_rules',
  'season_arc',
  'episode_grid',
  'character_bible',
  'pitch_document',
  'market_sheet',
  'vertical_market_sheet',
  'idea',
  'logline',
  'one_pager',
  'treatment',
  'blueprint',
  'architecture',
  'beat_sheet',
  'production_draft',
  'deck',
  'deck_text',
  'documentary_outline',
  'vertical_episode_beats',
  'series_writer',
  'outline',
  'long_synopsis',
  'series_overview',
  'future_seasons_map',
  'pilot_outline',
  'budget_topline',
  'finance_plan',
  'packaging_targets',
  'production_plan',
  'delivery_requirements',
  'story_arc_plan',
  'shoot_plan',
  'doc_premise_brief',
  'research_dossier',
  'other',
]);

// ── Comprehensive label map (UI display) ──

export const ALL_DOC_TYPE_LABELS: Record<string, string> = {
  // Script types
  screenplay_draft: 'Screenplay Draft',
  pilot_script: 'Pilot Script',
  episode_script: 'Episode Script',
  episodes_1_3_scripts: 'Episodes 1–3 Scripts',
  script: 'Script',
  season_scripts_bundle: 'Season Scripts Bundle',
  // Non-script types
  writers_room: "Writer's Room",
  notes: 'Notes',
  topline_narrative: 'Topline Narrative',
  concept_brief: 'Concept Brief',
  format_rules: 'Format Rules',
  season_arc: 'Season Arc',
  episode_grid: 'Episode Grid',
  character_bible: 'Character Bible',
  pitch_document: 'Pitch Document',
  market_sheet: 'Market Sheet',
  vertical_market_sheet: 'Market Sheet (VD)',
  idea: 'Idea',
  logline: 'Logline',
  one_pager: 'One-Pager',
  treatment: 'Treatment',
  blueprint: 'Season Blueprint',
  architecture: 'Series Architecture',
  beat_sheet: 'Episode Beat Sheet',
  production_draft: 'Production Draft',
  deck: 'Deck',
  deck_text: 'Deck',
  documentary_outline: 'Documentary Outline',
  vertical_episode_beats: 'Episode Beats',
  series_writer: 'Series Writer',
  outline: 'Outline',
  long_synopsis: 'Long Synopsis',
  series_overview: 'Series Overview',
  future_seasons_map: 'Future Seasons Map',
  pilot_outline: 'Pilot Outline',
  budget_topline: 'Budget Top-Line',
  finance_plan: 'Finance Plan',
  packaging_targets: 'Packaging Targets',
  production_plan: 'Production Plan',
  delivery_requirements: 'Delivery Requirements',
  story_arc_plan: 'Story Arc Plan',
  shoot_plan: 'Shoot Plan',
  doc_premise_brief: 'Documentary Premise',
  research_dossier: 'Research Dossier',
  other: 'Document',
};

/**
 * Normalize a doc_type key to canonical underscore form.
 * Use at all read/write boundaries.
 */
export function normalizeDocTypeKey(raw: string | null | undefined): string {
  return (raw || 'other').toLowerCase().trim().replace(/[\s\-]+/g, '_');
}

/**
 * Get a human-readable label for any doc_type.
 * NEVER defaults to "Script" — returns "Document" for unknown types.
 */
export function getDocTypeLabel(docType: string | null | undefined): string {
  const normalized = normalizeDocTypeKey(docType);
  const label = ALL_DOC_TYPE_LABELS[normalized];
  if (!label) {
    console.warn(`[DocType] Unknown doc_type encountered: "${docType}" (normalized: "${normalized}"). Displaying as "Document".`);
    return 'Document';
  }
  return label;
}

// ── Promote-to-Script gate ──

export interface PromoteToScriptInput {
  docType: string | null | undefined;
  linkedScriptId?: string | null;
  /** Minimum text length to qualify as script-promotable content */
  contentLength?: number;
}

export interface PromoteToScriptResult {
  eligible: boolean;
  reason: string;
}

/**
 * canPromoteToScript — single shared gate for "Publish as Script" CTA visibility.
 * Returns true ONLY if the artifact is eligible for script promotion.
 * Doc type is determined ONLY by stored doc_type — never by content analysis.
 */
export function canPromoteToScript(input: PromoteToScriptInput): PromoteToScriptResult {
  const normalized = normalizeDocTypeKey(input.docType);

  // Gate 1: Already a script doc_type
  if (SCRIPT_DOC_TYPES.has(normalized)) {
    console.log(`[Promote-to-Script] Blocked: already_script_doc_type "${normalized}"`);
    return {
      eligible: false,
      reason: `already_script_doc_type: ${normalized}`,
    };
  }

  // Gate 2: Already has a linked script record
  if (input.linkedScriptId) {
    console.log(`[Promote-to-Script] Blocked: linked_script_exists "${input.linkedScriptId}"`);
    return {
      eligible: false,
      reason: `linked_script_exists: ${input.linkedScriptId}`,
    };
  }

  // Gate 3: Content threshold (must have meaningful content)
  if (input.contentLength !== undefined && input.contentLength < 100) {
    return {
      eligible: false,
      reason: `content_too_short: ${input.contentLength} chars`,
    };
  }

  return {
    eligible: true,
    reason: 'eligible',
  };
}

/**
 * Returns true if the doc_type is already a script type.
 */
export function isScriptDocType(docType: string | null | undefined): boolean {
  return SCRIPT_DOC_TYPES.has(normalizeDocTypeKey(docType));
}
