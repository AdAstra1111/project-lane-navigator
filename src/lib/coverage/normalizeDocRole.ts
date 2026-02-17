/**
 * Maps existing document metadata into a stable CoverageRole
 * WITHOUT modifying stored labels or doc types.
 * Read-only normalization for coverage selection + UI grouping.
 */

import type { CoverageRole } from './types';

interface DocInput {
  doc_type?: string;
  deliverable_type?: string | null;
  title?: string | null;
  file_name?: string;
  label?: string | null;
  stage?: string | null;
}

const ROLE_MAP: Record<string, CoverageRole> = {
  // doc_type / deliverable_type keys
  concept_brief: 'concept',
  concept: 'concept',
  concept_lock: 'concept',
  market_sheet: 'market',
  market: 'market',
  market_positioning: 'market',
  deck: 'deck',
  pitch_deck: 'deck',
  lookbook: 'deck',
  blueprint: 'blueprint',
  series_bible: 'blueprint',
  beat_sheet: 'blueprint',
  character_bible: 'character_bible',
  character: 'character_bible',
  episode_grid: 'episode_grid',
  vertical_episode_beats: 'episode_grid',
  season_arc: 'season_arc',
  documentary_outline: 'documentary_outline',
  doc_outline: 'documentary_outline',
  format_rules: 'format_rules',
  // scripts
  script: 'feature_script',
  feature_script: 'feature_script',
  pilot_script: 'episode_script',
  episode_script: 'episode_script',
  episode_1_script: 'episode_script',
  production_draft: 'production_draft',
};

const TITLE_HINTS: [RegExp, CoverageRole][] = [
  [/concept\s*brief/i, 'concept'],
  [/market\s*(sheet|positioning)/i, 'market'],
  [/\bdeck\b/i, 'deck'],
  [/\blookbook\b/i, 'deck'],
  [/blueprint|series\s*bible/i, 'blueprint'],
  [/character\s*bible/i, 'character_bible'],
  [/episode\s*grid/i, 'episode_grid'],
  [/season\s*arc/i, 'season_arc'],
  [/documentary\s*outline/i, 'documentary_outline'],
  [/format\s*rules/i, 'format_rules'],
  [/pilot|episode\s*\d/i, 'episode_script'],
  [/\bscript\b/i, 'feature_script'],
];

export function normalizeDocRole(doc: DocInput): CoverageRole {
  // 1) Direct match on deliverable_type or doc_type
  const keys = [doc.deliverable_type, doc.doc_type].filter(Boolean) as string[];
  for (const k of keys) {
    const norm = k.toLowerCase().replace(/[-\s]/g, '_');
    if (ROLE_MAP[norm]) return ROLE_MAP[norm];
  }

  // 2) Label match
  if (doc.label) {
    const normLabel = doc.label.toLowerCase().replace(/[-\s]/g, '_');
    if (ROLE_MAP[normLabel]) return ROLE_MAP[normLabel];
  }

  // 3) Title / file_name heuristic (legacy fallback)
  const searchText = [doc.title, doc.file_name].filter(Boolean).join(' ');
  for (const [re, role] of TITLE_HINTS) {
    if (re.test(searchText)) return role;
  }

  return 'other';
}
