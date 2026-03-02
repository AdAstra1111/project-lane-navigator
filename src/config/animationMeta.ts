/**
 * Animation Genre / Subgenre / Style Registry — canonical FE source of truth.
 *
 * Stored in `projects.project_features` (merge-safe, no schema changes).
 * Gated by production_modality: only meaningful when modality != 'live_action'.
 *
 * IMPORTANT: Keep in sync with supabase/functions/_shared/animationMeta.ts
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type AnimationPrimary =
  | 'family_kids'
  | 'adult_animation'
  | 'anime_influenced'
  | 'action_superhero'
  | 'fantasy_mythic'
  | 'sci_fi_cyber'
  | 'comedy_satire'
  | 'horror_thriller'
  | 'romance_drama'
  | 'musical'
  | 'stop_motion_arthouse'
  | 'educational'
  | 'sports_competition'
  | 'slice_of_life';

export type AnimationStyle = '2d' | '3d' | 'stop_motion' | 'mixed';

// Tags are strings from ANIMATION_TAG_LIST; typed loosely for extensibility
export type AnimationTag = string;

// ── Canonical Lists ───────────────────────────────────────────────────────

export const ANIMATION_PRIMARY_LIST: readonly AnimationPrimary[] = [
  'family_kids',
  'adult_animation',
  'anime_influenced',
  'action_superhero',
  'fantasy_mythic',
  'sci_fi_cyber',
  'comedy_satire',
  'horror_thriller',
  'romance_drama',
  'musical',
  'stop_motion_arthouse',
  'educational',
  'sports_competition',
  'slice_of_life',
] as const;

export const ANIMATION_PRIMARY_LABELS: Record<AnimationPrimary, string> = {
  family_kids: 'Family / Kids',
  adult_animation: 'Adult Animation',
  anime_influenced: 'Anime-Influenced',
  action_superhero: 'Action / Superhero',
  fantasy_mythic: 'Fantasy / Mythic',
  sci_fi_cyber: 'Sci-Fi / Cyber',
  comedy_satire: 'Comedy / Satire',
  horror_thriller: 'Horror / Thriller',
  romance_drama: 'Romance / Drama',
  musical: 'Musical',
  stop_motion_arthouse: 'Stop-Motion / Arthouse',
  educational: 'Educational',
  sports_competition: 'Sports / Competition',
  slice_of_life: 'Slice of Life',
};

export const ANIMATION_STYLE_LIST: readonly AnimationStyle[] = [
  '2d', '3d', 'stop_motion', 'mixed',
] as const;

export const ANIMATION_STYLE_LABELS: Record<AnimationStyle, string> = {
  '2d': '2D Animation',
  '3d': '3D / CGI',
  'stop_motion': 'Stop-Motion',
  'mixed': 'Mixed Media',
};

export const ANIMATION_TAG_LIST: readonly string[] = [
  // Audience/Tone
  'preschool', 'kids_6_11', 'teen', 'adult', 'four_quadrant',
  'wholesome', 'dark', 'satirical', 'absurdist', 'prestige_drama',
  // Aesthetic/Format
  '2d', '3d', 'stop_motion', 'mixed_media', 'hand_drawn',
  'cg_stylized', 'limited_animation', 'high_fps_action', 'anime_visual_language',
  // Story Engines
  'talking_animals', 'magical_adventure', 'isekai', 'mecha', 'kaiju',
  'supernatural', 'mythology', 'cyberpunk', 'space_opera', 'dystopian',
  'time_travel', 'coming_of_age', 'workplace', 'mystery', 'heist', 'anthology',
  // Market Flags
  'merch_friendly', 'toyetic', 'music_driven', 'game_crossover',
  'franchiseable', 'global_dubbing_strong', 'festival_prestige',
] as const;

export const ANIMATION_TAG_CATEGORIES: Record<string, readonly string[]> = {
  'Audience / Tone': ['preschool', 'kids_6_11', 'teen', 'adult', 'four_quadrant', 'wholesome', 'dark', 'satirical', 'absurdist', 'prestige_drama'],
  'Aesthetic / Format': ['2d', '3d', 'stop_motion', 'mixed_media', 'hand_drawn', 'cg_stylized', 'limited_animation', 'high_fps_action', 'anime_visual_language'],
  'Story Engines': ['talking_animals', 'magical_adventure', 'isekai', 'mecha', 'kaiju', 'supernatural', 'mythology', 'cyberpunk', 'space_opera', 'dystopian', 'time_travel', 'coming_of_age', 'workplace', 'mystery', 'heist', 'anthology'],
  'Market Flags': ['merch_friendly', 'toyetic', 'music_driven', 'game_crossover', 'franchiseable', 'global_dubbing_strong', 'festival_prestige'],
};

// ── Data Shape ────────────────────────────────────────────────────────────

export interface AnimationMeta {
  primary: AnimationPrimary | null;
  tags: string[];
  style: AnimationStyle | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Read animation metadata from project_features JSON. Safe defaults.
 */
export function getAnimationMeta(
  projectFeatures: Record<string, any> | null | undefined,
): AnimationMeta {
  if (!projectFeatures) return { primary: null, tags: [], style: null };
  const raw = projectFeatures;
  return {
    primary: ANIMATION_PRIMARY_LIST.includes(raw.animation_genre_primary as AnimationPrimary)
      ? (raw.animation_genre_primary as AnimationPrimary)
      : null,
    tags: Array.isArray(raw.animation_genre_tags)
      ? (raw.animation_genre_tags as string[]).filter(t => ANIMATION_TAG_LIST.includes(t))
      : [],
    style: ANIMATION_STYLE_LIST.includes(raw.animation_style as AnimationStyle)
      ? (raw.animation_style as AnimationStyle)
      : null,
  };
}

/**
 * Merge animation meta into existing project_features (additive, merge-safe).
 */
export function setAnimationMeta(
  existingFeatures: Record<string, any> | null | undefined,
  meta: Partial<AnimationMeta>,
): Record<string, any> {
  const result = { ...(existingFeatures || {}) };
  if (meta.primary !== undefined) {
    result.animation_genre_primary = meta.primary && ANIMATION_PRIMARY_LIST.includes(meta.primary)
      ? meta.primary : null;
  }
  if (meta.tags !== undefined) {
    result.animation_genre_tags = (meta.tags || []).filter(t => ANIMATION_TAG_LIST.includes(t));
  }
  if (meta.style !== undefined) {
    result.animation_style = meta.style && ANIMATION_STYLE_LIST.includes(meta.style)
      ? meta.style : null;
  }
  return result;
}

/**
 * Build deterministic prompt block for animation metadata.
 * Returns '' if modality is live_action OR if no animation meta is set.
 */
export function buildAnimationMetaPromptBlock(
  modality: string,
  meta: AnimationMeta,
): string {
  if (modality === 'live_action') return '';
  const parts: string[] = [];
  if (meta.primary) parts.push(`Animation Genre: ${ANIMATION_PRIMARY_LABELS[meta.primary] || meta.primary}`);
  if (meta.style) parts.push(`Animation Style: ${ANIMATION_STYLE_LABELS[meta.style] || meta.style}`);
  if (meta.tags.length > 0) parts.push(`Animation Tags: ${meta.tags.join(', ')}`);
  if (parts.length === 0) return '';
  return `\n\n=== ANIMATION METADATA ===\n${parts.join('\n')}\n=== END ANIMATION METADATA ===\n`;
}
