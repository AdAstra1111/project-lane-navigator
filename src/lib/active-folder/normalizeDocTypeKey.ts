/**
 * Maps existing doc metadata into a stable doc_type_key for the Active Project Folder.
 * Read-only normalization — does NOT modify stored labels or doc types.
 */

export type DocTypeKey =
  | 'topline_narrative'
  | 'concept_brief'
  | 'character_bible'
  | 'market_sheet'
  | 'blueprint'
  | 'beat_sheet'
  | 'deck'
  | 'documentary_outline'
  | 'episode_grid'
  | 'season_arc'
  | 'episode_script'
  | 'feature_script'
  | 'format_rules'
  | 'production_draft'
  | 'other';

export const DOC_TYPE_KEY_LABELS: Record<DocTypeKey, string> = {
  topline_narrative: 'Topline Narrative',
  concept_brief: 'Concept Brief',
  character_bible: 'Character Bible',
  market_sheet: 'Market Sheet',
  blueprint: 'Blueprint / Series Bible',
  beat_sheet: 'Beat Sheet',
  deck: 'Deck',
  documentary_outline: 'Documentary Outline',
  episode_grid: 'Episode Grid',
  season_arc: 'Season Arc',
  episode_script: 'Episode Script (Pilot)',
  feature_script: 'Feature Script',
  format_rules: 'Format Rules',
  production_draft: 'Production Draft',
  other: 'Document',
};

interface DocInput {
  deliverable_type?: string | null;
  doc_type?: string;
  title?: string | null;
  file_name?: string;
  label?: string | null;
  stage?: string | null;
}

const KEY_MAP: Record<string, DocTypeKey> = {
  topline_narrative: 'topline_narrative',
  topline: 'topline_narrative',
  logline_synopsis: 'topline_narrative',
  narrative_summary: 'topline_narrative',
  synopsis: 'topline_narrative',
  short_synopsis: 'topline_narrative',
  long_synopsis: 'topline_narrative',
  logline: 'topline_narrative',
  narrative: 'topline_narrative',
  top_line: 'topline_narrative',
  topline_doc: 'topline_narrative',
  concept_brief: 'concept_brief',
  concept: 'concept_brief',
  concept_lock: 'concept_brief',
  market_sheet: 'market_sheet',
  market: 'market_sheet',
  market_positioning: 'market_sheet',
  deck: 'deck',
  pitch_deck: 'deck',
  lookbook: 'deck',
  blueprint: 'blueprint',
  series_bible: 'blueprint',
  beat_sheet: 'beat_sheet',
  character_bible: 'character_bible',
  character: 'character_bible',
  episode_grid: 'episode_grid',
  vertical_episode_beats: 'episode_grid',
  season_arc: 'season_arc',
  documentary_outline: 'documentary_outline',
  doc_outline: 'documentary_outline',
  format_rules: 'format_rules',
  script: 'feature_script',
  script_pdf: 'feature_script',
  feature_script: 'feature_script',
  pilot_script: 'episode_script',
  episode_script: 'episode_script',
  episode_1_script: 'episode_script',
  production_draft: 'production_draft',
};

const TITLE_HINTS: [RegExp, DocTypeKey][] = [
  [/topline/i, 'topline_narrative'],
  [/\blogline\b/i, 'topline_narrative'],
  [/\bsynopsis\b/i, 'topline_narrative'],
  [/narrative\s*(summary|topline)/i, 'topline_narrative'],
  [/concept\s*brief/i, 'concept_brief'],
  [/market\s*(sheet|positioning)/i, 'market_sheet'],
  [/\bdeck\b/i, 'deck'],
  [/\blookbook\b/i, 'deck'],
  [/blueprint|series\s*bible/i, 'blueprint'],
  [/beat\s*sheet/i, 'beat_sheet'],
  [/character\s*bible/i, 'character_bible'],
  [/episode\s*grid/i, 'episode_grid'],
  [/season\s*arc/i, 'season_arc'],
  [/documentary\s*outline/i, 'documentary_outline'],
  [/format\s*rules/i, 'format_rules'],
  [/pilot|episode\s*1\b/i, 'episode_script'],
  [/\bscript\b/i, 'feature_script'],
];

/**
 * Normalize a document's metadata into a stable doc_type_key.
 * @param isSeries - whether the project is a series format
 */
export function normalizeDocTypeKey(doc: DocInput, isSeries = false): DocTypeKey {
  // 1) Direct match on deliverable_type or doc_type
  const keys = [doc.deliverable_type, doc.doc_type].filter(Boolean) as string[];
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[-\s]/g, '_');
    if (KEY_MAP[norm]) {
      let key = KEY_MAP[norm];
      // For series: scripts should map to episode_script
      if (isSeries && key === 'feature_script') key = 'episode_script';
      return key;
    }
  }

  // 2) Label match
  if (doc.label) {
    const normLabel = doc.label.toLowerCase().replace(/[-\s]/g, '_');
    if (KEY_MAP[normLabel]) return KEY_MAP[normLabel];
  }

  // 3) Title / file_name heuristic (legacy fallback)
  const searchText = [doc.title, doc.file_name].filter(Boolean).join(' ');
  for (const [re, key] of TITLE_HINTS) {
    if (re.test(searchText)) {
      if (isSeries && key === 'feature_script') return 'episode_script';
      return key;
    }
  }

  return 'other';
}
