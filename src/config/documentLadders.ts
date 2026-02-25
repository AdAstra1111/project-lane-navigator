/**
 * Canonical Document Ladders — lane-aware document type registry.
 *
 * This is the FRONTEND source of truth for:
 *  - Official document types per lane
 *  - Legacy label → canonical key aliases
 *  - Lane-aware validation helpers
 *
 * The backend mirror lives at supabase/functions/_shared/documentLadders.ts
 * and is kept in sync via src/test/document-ladders-drift.test.ts.
 *
 * NOTE: The pipeline stage ordering (idea → concept_brief → … → deck) is
 * governed by supabase/_shared/stage-ladders.json via src/lib/stages/registry.ts.
 * This module adds the LANE overlay (which doc types are allowed per market lane)
 * and normalizes legacy labels that LLMs or old data may produce.
 */

// ── Lane keys (market lanes from assigned_lane on projects) ────────────────

export type LaneKey =
  | 'feature_film'
  | 'series'
  | 'vertical_drama'
  | 'documentary'
  | 'animation'
  | 'short'
  | 'unspecified';

// ── Doc type metadata ──────────────────────────────────────────────────────

export interface DocTypeMeta {
  label: string;
  description?: string;
}

/** All known canonical doc type keys with human labels. */
export const BASE_DOC_TYPES: Record<string, DocTypeMeta> = {
  idea:                    { label: 'Idea / Logline',          description: 'Initial concept or logline' },
  concept_brief:           { label: 'Concept Brief',           description: 'One-pager expanding the idea' },
  market_sheet:            { label: 'Market Sheet',            description: 'Market positioning analysis' },
  vertical_market_sheet:   { label: 'Vertical Market Sheet',   description: 'Market sheet for vertical formats' },
  blueprint:               { label: 'Blueprint',               description: 'Treatment / series bible / structural overview' },
  architecture:            { label: 'Architecture',            description: 'Plot architecture / structural outline' },
  character_bible:         { label: 'Character Bible',         description: 'Character profiles and arcs' },
  beat_sheet:              { label: 'Beat Sheet',              description: 'Scene-by-scene beat structure' },
  feature_script:          { label: 'Feature Script',          description: 'Full screenplay for film / feature' },
  episode_script:          { label: 'Episode Script',          description: 'Script for a single episode' },
  season_master_script:    { label: 'Season Master Script',    description: 'Compiled season scripts' },
  production_draft:        { label: 'Production Draft',        description: 'Final production-ready draft' },
  deck:                    { label: 'Deck',                    description: 'Pitch deck / lookbook' },
  documentary_outline:     { label: 'Documentary Outline',     description: 'Story structure for documentary' },
  format_rules:            { label: 'Format Rules',            description: 'Vertical drama format constraints' },
  season_arc:              { label: 'Season Arc',              description: 'Season-level arc and episode progression' },
  episode_grid:            { label: 'Episode Grid',            description: 'Grid of all episodes with hooks/turns' },
  vertical_episode_beats:  { label: 'Vertical Episode Beats',  description: 'Beat sheets for vertical episodes' },
  topline_narrative:       { label: 'Topline Narrative',       description: 'Synopsis + logline + story pillars' },
};

// ── Lane-specific ladders ──────────────────────────────────────────────────

/**
 * The official document ladder for each lane. Documents not in the ladder
 * are considered non-standard for that lane and may trigger notes.
 *
 * These align with FORMAT_LADDERS in stage-ladders.json but are keyed by
 * market lane rather than format slug.
 */
export const LANE_DOC_LADDERS: Record<LaneKey, string[]> = {
  feature_film: [
    'idea', 'concept_brief', 'market_sheet', 'blueprint', 'architecture',
    'character_bible', 'beat_sheet', 'feature_script', 'production_draft', 'deck',
  ],
  series: [
    'idea', 'concept_brief', 'market_sheet', 'blueprint', 'architecture',
    'character_bible', 'beat_sheet', 'episode_script', 'season_master_script', 'production_draft',
  ],
  vertical_drama: [
    'idea', 'concept_brief', 'vertical_market_sheet', 'format_rules',
    'character_bible', 'season_arc', 'episode_grid', 'vertical_episode_beats',
    'episode_script', 'season_master_script',
  ],
  documentary: [
    'idea', 'concept_brief', 'market_sheet', 'documentary_outline', 'deck',
  ],
  animation: [
    'idea', 'concept_brief', 'market_sheet', 'blueprint',
    'character_bible', 'beat_sheet', 'feature_script',
  ],
  short: [
    'idea', 'concept_brief', 'feature_script',
  ],
  unspecified: [
    'idea', 'concept_brief', 'market_sheet', 'blueprint', 'architecture',
    'character_bible', 'beat_sheet', 'feature_script', 'production_draft', 'deck',
  ],
};

// ── Legacy label aliases ───────────────────────────────────────────────────

/**
 * Maps legacy, variant, or LLM-invented labels to canonical doc type keys.
 * Applied during normalizeDocType().
 */
export const DOC_LABEL_ALIASES: Record<string, string> = {
  // Legacy structural labels
  treatment:               'blueprint',
  series_bible:            'blueprint',
  outline:                 'blueprint',
  season_outline:          'blueprint',
  plot_architecture:       'architecture',

  // Script variants
  script:                  'feature_script',
  screenplay:              'feature_script',
  script_pdf:              'feature_script',
  draft:                   'feature_script',
  screenplay_draft:        'feature_script',
  pilot_script:            'episode_script',
  episode_1_script:        'episode_script',

  // Idea variants
  logline:                 'idea',
  one_pager:               'concept_brief',
  concept:                 'concept_brief',
  concept_lock:            'concept_brief',
  notes:                   'concept_brief',

  // Other aliases
  pitch_deck:              'deck',
  lookbook:                'deck',
  coverage:                'production_draft',
  episode_beats:           'vertical_episode_beats',
  episode_beat_sheet:       'beat_sheet',
  complete_season_script:  'season_master_script',
  doc_outline:             'documentary_outline',
  writers_room:            'episode_script',

  // Topline
  synopsis:                'topline_narrative',
  short_synopsis:          'topline_narrative',
  long_synopsis:           'topline_narrative',
  narrative:               'topline_narrative',
  topline:                 'topline_narrative',
};

// ── Normalization ──────────────────────────────────────────────────────────

/**
 * Normalize a doc type string to its canonical key.
 * Lowercases, strips whitespace, replaces spaces/hyphens with underscores,
 * then applies alias mapping.
 */
export function normalizeDocType(input: string): string {
  if (!input) return input;
  const key = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return DOC_LABEL_ALIASES[key] ?? key;
}

// ── Lane helpers ───────────────────────────────────────────────────────────

/** Get the official document ladder for a lane (falls back to 'unspecified'). */
export function getLaneLadder(lane: string | null | undefined): string[] {
  const key = (lane || 'unspecified') as LaneKey;
  return LANE_DOC_LADDERS[key] ?? LANE_DOC_LADDERS.unspecified;
}

/** Check if a doc type is allowed in a given lane's ladder. */
export function isDocTypeAllowedInLane(lane: string | null | undefined, docType: string): boolean {
  const ladder = getLaneLadder(lane);
  const normalized = normalizeDocType(docType);
  return ladder.includes(normalized);
}

/** Get the human-readable label for a canonical doc type key. */
export function getDocTypeLabel(docTypeKey: string): string {
  return BASE_DOC_TYPES[docTypeKey]?.label ?? docTypeKey.replace(/_/g, ' ');
}

/**
 * Map a format slug (from projects.format) to its corresponding lane key.
 * Used when only the format is available but lane-aware logic is needed.
 */
export function formatToLane(format: string | null | undefined): LaneKey {
  const f = (format || '').toLowerCase().replace(/[_ ]+/g, '-');
  switch (f) {
    case 'film':
    case 'feature':
      return 'feature_film';
    case 'tv-series':
    case 'limited-series':
    case 'digital-series':
    case 'anim-series':
    case 'reality':
      return 'series';
    case 'vertical-drama':
      return 'vertical_drama';
    case 'documentary':
    case 'documentary-series':
    case 'hybrid-documentary':
      return 'documentary';
    case 'animation':
      return 'animation';
    case 'short':
      return 'short';
    default:
      return 'unspecified';
  }
}

/**
 * Build the allowed-labels instruction block for LLM system prompts.
 * Tells the model which document types are official for this lane.
 */
export function buildLadderPromptBlock(lane: string | null | undefined): string {
  const ladder = getLaneLadder(lane);
  const labels = ladder.map(k => getDocTypeLabel(k));
  return [
    '## OFFICIAL DOCUMENT TYPES FOR THIS LANE',
    `Use ONLY these official document types: ${labels.join(', ')}.`,
    'Do not invent new document type labels like \\"Blueprint\\" or \\"Architecture\\" unless they appear in the list above.',
    'If referring to structural sections, use the official labels.',
  ].join('\n');
}
