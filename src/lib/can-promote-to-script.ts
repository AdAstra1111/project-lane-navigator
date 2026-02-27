/**
 * Canonical doc_type taxonomy — single source of truth.
 * All doc_type classification MUST use these sets. No content-based heuristics.
 */

// ── Canonical doc_type sets ──

export const SCRIPT_DOC_TYPES = new Set([
  'screenplay_draft',
  'pilot_script',
  'episode_script',
  'feature_script',
  'episodes_1_3_scripts',
  'script',
  'script_pdf',
  'season_scripts_bundle',
  'season_master_script',
  'complete_season_script',
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
  'document',
]);

// ── Comprehensive label map (UI display) ──

export const ALL_DOC_TYPE_LABELS: Record<string, string> = {
  // Script types
  screenplay_draft: 'Screenplay Draft',
  pilot_script: 'Pilot Script',
  feature_script: 'Feature Script',
  episode_script: 'Episode Script',
  episodes_1_3_scripts: 'Episodes 1–3 Scripts',
  script: 'Script',
  script_pdf: 'Script (PDF)',
  script_latest: 'Script',
  script_older: 'Script (Older Draft)',
  season_scripts_bundle: 'Season Scripts Bundle',
  season_master_script: 'Master Season Script',
  complete_season_script: 'Master Season Script',
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
  story_outline: 'Story Outline',
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
  script_coverage: 'Script Coverage',
  trailer_script: 'Trailer Script',
  // Seed core docs
  project_overview: 'Project Overview',
  creative_brief: 'Creative Brief',
  market_positioning: 'Market Positioning',
  canon: 'Canon & Constraints',
  nec: 'Narrative Energy Contract',
  // Fallbacks
  other: 'Document',
  document: 'Document',
};

/**
 * Format-specific label overrides for non-series projects.
 * Film/feature/short/documentary projects should NOT see series terminology.
 */
const NON_SERIES_FORMATS = new Set(['film', 'feature', 'short', 'documentary', 'hybrid-documentary', 'short-film']);
const FILM_DOC_LABEL_OVERRIDES: Record<string, string> = {
  blueprint: 'Blueprint',
  architecture: 'Architecture',
  beat_sheet: 'Beat Sheet',
  season_arc: 'Story Arc',
};

/**
 * Normalize a doc_type key to canonical underscore form.
 * Use at all read/write boundaries.
 */
export function normalizeDocTypeKey(raw: string | null | undefined): string {
  return (raw || 'other').toLowerCase().trim().replace(/[\s\-]+/g, '_');
}

/**
 * Compute the display name for a document.
 * ALWAYS derived from the live project title + doc_type label.
 * Never use stored doc.title or doc.file_name for display.
 *
 * Format: "Project Title — Doc Type Label"
 * Fallback: just the doc type label if no project title available.
 */
export function getDocDisplayName(
  projectTitle: string | null | undefined,
  docType: string | null | undefined,
  format?: string | null,
): string {
  const label = getDocTypeLabel(docType, format);
  if (projectTitle?.trim()) return `${projectTitle.trim()} \u2014 ${label}`;
  return label;
}

/**
 * Build a canonical filename for downloads.
 * Format: "{ProjectTitle} - {DocTypeLabel} - {versionTag} - {date}.{ext}"
 *
 * This is the SINGLE SOURCE OF TRUTH for download filenames across the app.
 */
export function getCanonicalFilename(opts: {
  projectTitle: string | null | undefined;
  docType: string | null | undefined;
  versionTag?: string;
  date?: string;
  ext?: string;
  descriptor?: string;
}): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9\s\-]/g, '').trim().replace(/\s+/g, '_');
  const title = sanitize(opts.projectTitle?.trim() || 'Document');
  const label = sanitize(getDocTypeLabel(opts.docType));
  const parts = [title, label];
  if (opts.descriptor) parts.push(sanitize(opts.descriptor));
  if (opts.versionTag) parts.push(opts.versionTag);
  if (opts.date) parts.push(opts.date);
  return `${parts.join(' - ')}.${opts.ext || 'md'}`;
}

/**
 * Get a human-readable label for any doc_type.
 * Accepts optional format to apply film/feature-specific overrides.
 * NEVER defaults to "Script" — returns "Document" for unknown types.
 */
export function getDocTypeLabel(docType: string | null | undefined, format?: string | null): string {
  // Derived doc types keyed by source doc ID — display friendly labels
  if (docType?.startsWith('scene_graph__')) return 'Scene Index';
  if (docType?.startsWith('change_report__')) return 'Change Report';
  if (docType === 'universe_manifest') return 'Universe Manifest';

  const normalized = normalizeDocTypeKey(docType);

  // Apply format-specific overrides for non-series formats
  const normalizedFormat = (format || '').toLowerCase().trim().replace(/[\s\-]+/g, '_').replace(/_/g, '-');
  if (normalizedFormat && NON_SERIES_FORMATS.has(normalizedFormat)) {
    const override = FILM_DOC_LABEL_OVERRIDES[normalized];
    if (override) return override;
  }

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
