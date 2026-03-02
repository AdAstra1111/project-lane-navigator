/**
 * Animation Genre / Subgenre / Style Registry — backend canonical mirror.
 *
 * Mirror of src/config/animationMeta.ts for edge functions.
 * Kept in sync manually; changes must be reflected in both files.
 */

// ── Canonical Lists ───────────────────────────────────────────────────────

export const ANIMATION_PRIMARY_LIST: readonly string[] = [
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
];

export const ANIMATION_STYLE_LIST: readonly string[] = [
  '2d', '3d', 'stop_motion', 'mixed',
];

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
];

export const ANIMATION_PRIMARY_LABELS: Record<string, string> = {
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

export const ANIMATION_STYLE_LABELS: Record<string, string> = {
  '2d': '2D Animation',
  '3d': '3D / CGI',
  'stop_motion': 'Stop-Motion',
  'mixed': 'Mixed Media',
};

// ── Data Shape ────────────────────────────────────────────────────────────

export interface AnimationMeta {
  primary: string | null;
  tags: string[];
  style: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function getAnimationMeta(
  projectFeatures: Record<string, any> | null | undefined,
): AnimationMeta {
  if (!projectFeatures) return { primary: null, tags: [], style: null };
  const raw = projectFeatures;
  return {
    primary: ANIMATION_PRIMARY_LIST.includes(raw.animation_genre_primary)
      ? raw.animation_genre_primary
      : null,
    tags: Array.isArray(raw.animation_genre_tags)
      ? (raw.animation_genre_tags as string[]).filter(t => ANIMATION_TAG_LIST.includes(t))
      : [],
    style: ANIMATION_STYLE_LIST.includes(raw.animation_style)
      ? raw.animation_style
      : null,
  };
}

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
