/**
 * lookbookSlotRegistry — Single source of truth for all section/slot/asset-group mappings.
 * Replaces 6+ duplicate mapping locations across the LookBook system.
 *
 * Every module that needs to map between slide types, sections, asset groups,
 * strategy keys, or subject types MUST consume this registry.
 */

// ── Canonical Section Key ────────────────────────────────────────────────────

export type CanonicalSectionKey =
  | 'character_identity'
  | 'world_locations'
  | 'atmosphere_lighting'
  | 'texture_detail'
  | 'symbolic_motifs'
  | 'key_moments'
  | 'poster_directions';

// ── Subject Type ─────────────────────────────────────────────────────────────

export type SubjectType = 'character' | 'world' | 'atmosphere' | 'moment' | 'texture' | 'poster' | 'generic';

// ── Pool Key ─────────────────────────────────────────────────────────────────

export type PoolKey = 'world' | 'atmosphere' | 'texture' | 'motifs' | 'keyMoments' | 'poster';

// ── Canonical Mapping: Section → Query Params ────────────────────────────────

export interface SectionQuerySpec {
  strategy_keys: string[];
  asset_groups: string[];
  fallback_roles?: string[];
}

export const SECTION_QUERY_MAP: Record<CanonicalSectionKey, SectionQuerySpec> = {
  character_identity: {
    strategy_keys: ['lookbook_character'],
    asset_groups: ['character'],
    fallback_roles: ['character_primary', 'character_variant'],
  },
  world_locations: {
    strategy_keys: ['lookbook_world'],
    asset_groups: ['world'],
    fallback_roles: ['world_establishing', 'world_detail'],
  },
  atmosphere_lighting: {
    strategy_keys: ['lookbook_visual_language'],
    asset_groups: ['visual_language'],
  },
  texture_detail: {
    strategy_keys: ['lookbook_visual_language'],
    asset_groups: ['visual_language'],
  },
  symbolic_motifs: {
    strategy_keys: ['lookbook_key_moment'],
    asset_groups: ['key_moment'],
  },
  key_moments: {
    strategy_keys: ['lookbook_key_moment'],
    asset_groups: ['key_moment'],
  },
  poster_directions: {
    strategy_keys: [],
    asset_groups: ['poster'],
    fallback_roles: ['poster_primary', 'poster_variant'],
  },
};

// ── Shot type filters per section ────────────────────────────────────────────

export const SECTION_SHOT_FILTER: Partial<Record<CanonicalSectionKey, string[]>> = {
  atmosphere_lighting: ['atmospheric', 'time_variant', 'lighting_ref'],
  texture_detail: ['texture_ref', 'detail', 'composition_ref', 'color_ref'],
  key_moments: ['tableau', 'medium', 'close_up', 'wide'],
};

// ── Slide Type → Subject Type ────────────────────────────────────────────────

export const SLIDE_SUBJECT_TYPE: Record<string, SubjectType> = {
  cover: 'poster',
  creative_statement: 'atmosphere',
  world: 'world',
  key_moments: 'moment',
  characters: 'character',
  visual_language: 'texture',
  themes: 'atmosphere',
  story_engine: 'moment',
  comparables: 'atmosphere',
  closing: 'poster',
};

// ── Slide Type → Pool Key ────────────────────────────────────────────────────

export const SLIDE_TO_POOL: Record<string, PoolKey> = {
  cover: 'poster',
  closing: 'poster',
  world: 'world',
  themes: 'atmosphere',
  creative_statement: 'atmosphere',
  visual_language: 'texture',
  key_moments: 'keyMoments',
  story_engine: 'keyMoments',
};

// ── Slide Type → Section Affinity (for background selection) ─────────────────

export const SLIDE_SECTION_AFFINITY: Record<string, PoolKey[]> = {
  cover: ['poster', 'world', 'keyMoments'],
  creative_statement: ['atmosphere', 'world'],
  world: ['world'],
  key_moments: ['keyMoments'],
  characters: [],
  visual_language: ['texture', 'motifs', 'atmosphere'],
  themes: ['atmosphere', 'world'],
  story_engine: ['keyMoments', 'motifs'],
  comparables: ['atmosphere', 'world'],
  closing: ['poster', 'world', 'atmosphere'],
};

// ── Subject → Asset Group (for orchestrator) ─────────────────────────────────

export const SUBJECT_TO_ASSET_GROUP: Record<string, string> = {
  character: 'character',
  world: 'world',
  atmosphere: 'visual_language',
  moment: 'key_moment',
  texture: 'visual_language',
  poster: 'poster',
  generic: 'visual_language',
};

// ── Subject → Strategy Keys (for orchestrator) ───────────────────────────────

export const SUBJECT_TO_STRATEGY_KEYS: Record<string, string[]> = {
  character: ['lookbook_character'],
  world: ['lookbook_world'],
  atmosphere: ['lookbook_visual_language'],
  moment: ['lookbook_key_moment'],
  texture: ['lookbook_visual_language'],
  poster: [],
  generic: ['lookbook_visual_language'],
};

// ── Section Key → Edge Function Section Param ────────────────────────────────

export function sectionKeyToEdgeFunctionSection(sectionKey: CanonicalSectionKey): string {
  switch (sectionKey) {
    case 'character_identity': return 'character';
    case 'world_locations': return 'world';
    case 'atmosphere_lighting': return 'visual_language';
    case 'texture_detail': return 'visual_language';
    case 'symbolic_motifs': return 'key_moment';
    case 'key_moments': return 'key_moment';
    case 'poster_directions': return 'world';
  }
}

export function sectionKeyToAssetGroup(sectionKey: CanonicalSectionKey): string {
  switch (sectionKey) {
    case 'character_identity': return 'character';
    case 'world_locations': return 'world';
    case 'atmosphere_lighting': return 'visual_language';
    case 'texture_detail': return 'visual_language';
    case 'symbolic_motifs': return 'key_moment';
    case 'key_moments': return 'key_moment';
    case 'poster_directions': return 'poster';
  }
}
