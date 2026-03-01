/**
 * docFlowMap — Single source of truth for lane-aware document flow.
 *
 * Determines:
 *  - Which tabs/doc types are visible per lane
 *  - Which conversions are allowed
 *  - The primary "happy path" flow
 *  - Lane-specific labels
 *
 * DETERMINISTIC. No LLM passes. DB is source of truth for lane assignment.
 */

import type { LaneKey } from '@/config/documentLadders';

// ── Types ──

export interface DocFlowTab {
  key: string;
  label: string;
  docTypes: string[];
}

export interface DocFlowConversion {
  from: string;
  to: string;
  label: string;
}

export interface DocFlowConfig {
  lane: LaneKey;
  topTabs: DocFlowTab[];
  allowedConversions: DocFlowConversion[];
  primaryFlow: string[];
  hiddenDocTypes: string[];
}

// ── Configs ──

const VERTICAL_DRAMA_CONFIG: DocFlowConfig = {
  lane: 'vertical_drama',
  topTabs: [
    { key: 'idea',         label: 'Idea',                 docTypes: ['idea', 'concept_brief'] },
    { key: 'rules',        label: 'Format Rules',         docTypes: ['format_rules', 'vertical_market_sheet'] },
    { key: 'characters',   label: 'Character Bible',      docTypes: ['character_bible'] },
    { key: 'season_arc',   label: 'Season Arc',           docTypes: ['season_arc'] },
    { key: 'ep_grid',      label: 'Episode Grid',         docTypes: ['episode_grid'] },
    { key: 'ep_beats',     label: 'Episode Beats',        docTypes: ['vertical_episode_beats'] },
    { key: 'ep_script',    label: 'Season Script',        docTypes: ['season_script'] },
    { key: 'series_writer',label: 'Series Writer',        docTypes: ['season_script'] },
    { key: 'master',       label: 'Master Season Script', docTypes: ['season_master_script'] },
  ],
  allowedConversions: [],
  primaryFlow: ['episode_grid', 'vertical_episode_beats', 'season_script', 'season_master_script'],
  hiddenDocTypes: ['feature_script', 'production_draft', 'market_sheet', 'story_outline', 'beat_sheet'],
};

const SERIES_CONFIG: DocFlowConfig = {
  lane: 'series',
  topTabs: [
    { key: 'idea',         label: 'Idea',                 docTypes: ['idea', 'concept_brief'] },
    { key: 'market',       label: 'Market Sheet',         docTypes: ['market_sheet'] },
    { key: 'treatment',    label: 'Treatment',            docTypes: ['treatment', 'story_outline'] },
    { key: 'characters',   label: 'Character Bible',      docTypes: ['character_bible'] },
    { key: 'beats',        label: 'Beat Sheet',           docTypes: ['beat_sheet', 'episode_beats'] },
    { key: 'ep_script',    label: 'Episode Script',       docTypes: ['episode_script'] },
    { key: 'series_writer',label: 'Series Writer',        docTypes: ['episode_script'] },
    { key: 'master',       label: 'Master Season Script', docTypes: ['season_master_script'] },
    { key: 'prod_draft',   label: 'Production Draft',     docTypes: ['production_draft'] },
  ],
  allowedConversions: [],
  primaryFlow: ['beat_sheet', 'episode_script', 'season_master_script', 'production_draft'],
  hiddenDocTypes: ['feature_script'],
};

const FEATURE_FILM_CONFIG: DocFlowConfig = {
  lane: 'feature_film',
  topTabs: [
    { key: 'idea',         label: 'Idea',             docTypes: ['idea', 'concept_brief'] },
    { key: 'market',       label: 'Market Sheet',     docTypes: ['market_sheet'] },
    { key: 'treatment',    label: 'Treatment',        docTypes: ['treatment', 'story_outline'] },
    { key: 'characters',   label: 'Character Bible',  docTypes: ['character_bible'] },
    { key: 'beats',        label: 'Beat Sheet',       docTypes: ['beat_sheet'] },
    { key: 'script',       label: 'Feature Script',   docTypes: ['feature_script'] },
    { key: 'prod_draft',   label: 'Production Draft', docTypes: ['production_draft'] },
    { key: 'deck',         label: 'Deck',             docTypes: ['deck'] },
  ],
  allowedConversions: [
    { from: 'beat_sheet', to: 'feature_script', label: 'Convert → Feature Script' },
    { from: 'treatment',  to: 'feature_script', label: 'Convert → Feature Script' },
  ],
  primaryFlow: ['beat_sheet', 'feature_script', 'production_draft', 'deck'],
  hiddenDocTypes: ['episode_script', 'season_master_script', 'episode_grid', 'vertical_episode_beats', 'format_rules', 'season_arc', 'vertical_market_sheet'],
};

const DOCUMENTARY_CONFIG: DocFlowConfig = {
  lane: 'documentary',
  topTabs: [
    { key: 'idea',        label: 'Idea',                docTypes: ['idea', 'concept_brief'] },
    { key: 'market',      label: 'Market Sheet',        docTypes: ['market_sheet'] },
    { key: 'doc_outline', label: 'Documentary Outline', docTypes: ['documentary_outline'] },
    { key: 'deck',        label: 'Deck',                docTypes: ['deck'] },
  ],
  allowedConversions: [],
  primaryFlow: ['documentary_outline', 'deck'],
  hiddenDocTypes: ['feature_script', 'episode_script', 'season_master_script', 'beat_sheet'],
};

const ANIMATION_CONFIG: DocFlowConfig = {
  lane: 'animation',
  topTabs: [
    { key: 'idea',       label: 'Idea',            docTypes: ['idea', 'concept_brief'] },
    { key: 'market',     label: 'Market Sheet',    docTypes: ['market_sheet'] },
    { key: 'treatment',  label: 'Treatment',       docTypes: ['treatment'] },
    { key: 'characters', label: 'Character Bible', docTypes: ['character_bible'] },
    { key: 'beats',      label: 'Beat Sheet',      docTypes: ['beat_sheet'] },
    { key: 'script',     label: 'Feature Script',  docTypes: ['feature_script'] },
  ],
  allowedConversions: [
    { from: 'beat_sheet', to: 'feature_script', label: 'Convert → Feature Script' },
  ],
  primaryFlow: ['beat_sheet', 'feature_script'],
  hiddenDocTypes: ['episode_script', 'season_master_script'],
};

const SHORT_CONFIG: DocFlowConfig = {
  lane: 'short',
  topTabs: [
    { key: 'idea',   label: 'Idea',           docTypes: ['idea', 'concept_brief'] },
    { key: 'script', label: 'Feature Script', docTypes: ['feature_script'] },
  ],
  allowedConversions: [],
  primaryFlow: ['feature_script'],
  hiddenDocTypes: ['episode_script', 'season_master_script', 'beat_sheet'],
};

const UNSPECIFIED_CONFIG: DocFlowConfig = {
  ...FEATURE_FILM_CONFIG,
  lane: 'unspecified',
};

// ── Registry ──

const DOC_FLOW_MAP: Record<LaneKey, DocFlowConfig> = {
  feature_film:   FEATURE_FILM_CONFIG,
  series:         SERIES_CONFIG,
  vertical_drama: VERTICAL_DRAMA_CONFIG,
  documentary:    DOCUMENTARY_CONFIG,
  animation:      ANIMATION_CONFIG,
  short:          SHORT_CONFIG,
  unspecified:    UNSPECIFIED_CONFIG,
};

// ── Public API ──

export function getDocFlowConfig(lane: string | null | undefined): DocFlowConfig {
  const key = (lane || 'unspecified') as LaneKey;
  return DOC_FLOW_MAP[key] ?? DOC_FLOW_MAP.unspecified;
}

/**
 * Check if a specific conversion is allowed for the given lane.
 */
export function isConversionAllowed(
  lane: string | null | undefined,
  fromDocType: string,
  toDocType: string,
): boolean {
  const config = getDocFlowConfig(lane);
  return config.allowedConversions.some(
    c => c.from === fromDocType && c.to === toDocType,
  );
}

/**
 * Get the label for a conversion if allowed, or null.
 */
export function getConversionLabel(
  lane: string | null | undefined,
  fromDocType: string,
  toDocType: string,
): string | null {
  const config = getDocFlowConfig(lane);
  const match = config.allowedConversions.find(
    c => c.from === fromDocType && c.to === toDocType,
  );
  return match?.label ?? null;
}

/**
 * Check if a doc type should be hidden for a given lane.
 */
export function isDocTypeHiddenForLane(
  lane: string | null | undefined,
  docType: string,
): boolean {
  const config = getDocFlowConfig(lane);
  return config.hiddenDocTypes.includes(docType);
}

/**
 * Get allowed conversion targets for a given source doc type and lane.
 */
export function getAllowedConversionsFrom(
  lane: string | null | undefined,
  fromDocType: string,
): DocFlowConversion[] {
  const config = getDocFlowConfig(lane);
  return config.allowedConversions.filter(c => c.from === fromDocType);
}
