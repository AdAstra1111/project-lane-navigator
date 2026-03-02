/**
 * Animation Meta Drift-Lock Test
 *
 * Ensures FE (src/config/animationMeta.ts) lists stay in sync with BE mirror.
 * BE values are hardcoded here (same as supabase/functions/_shared/animationMeta.ts).
 */
import { describe, it, expect } from 'vitest';
import * as fe from '@/config/animationMeta';

// ── BE values (manually mirrored — update if BE changes) ──
const BE_PRIMARY_LIST = [
  'family_kids', 'adult_animation', 'anime_influenced', 'action_superhero',
  'fantasy_mythic', 'sci_fi_cyber', 'comedy_satire', 'horror_thriller',
  'romance_drama', 'musical', 'stop_motion_arthouse', 'educational',
  'sports_competition', 'slice_of_life',
];

const BE_STYLE_LIST = ['2d', '3d', 'stop_motion', 'mixed'];

const BE_TAG_LIST = [
  'preschool', 'kids_6_11', 'teen', 'adult', 'four_quadrant',
  'wholesome', 'dark', 'satirical', 'absurdist', 'prestige_drama',
  '2d', '3d', 'stop_motion', 'mixed_media', 'hand_drawn',
  'cg_stylized', 'limited_animation', 'high_fps_action', 'anime_visual_language',
  'talking_animals', 'magical_adventure', 'isekai', 'mecha', 'kaiju',
  'supernatural', 'mythology', 'cyberpunk', 'space_opera', 'dystopian',
  'time_travel', 'coming_of_age', 'workplace', 'mystery', 'heist', 'anthology',
  'merch_friendly', 'toyetic', 'music_driven', 'game_crossover',
  'franchiseable', 'global_dubbing_strong', 'festival_prestige',
];

describe('Animation Meta Drift-Lock', () => {
  it('FE ANIMATION_PRIMARY_LIST matches BE', () => {
    expect([...fe.ANIMATION_PRIMARY_LIST]).toEqual(BE_PRIMARY_LIST);
  });

  it('FE ANIMATION_STYLE_LIST matches BE', () => {
    expect([...fe.ANIMATION_STYLE_LIST]).toEqual(BE_STYLE_LIST);
  });

  it('FE ANIMATION_TAG_LIST matches BE', () => {
    expect([...fe.ANIMATION_TAG_LIST]).toEqual(BE_TAG_LIST);
  });

  it('ANIMATION_PRIMARY_LABELS has entries for all primaries', () => {
    for (const p of fe.ANIMATION_PRIMARY_LIST) {
      expect(fe.ANIMATION_PRIMARY_LABELS[p]).toBeTruthy();
    }
  });

  it('ANIMATION_STYLE_LABELS has entries for all styles', () => {
    for (const s of fe.ANIMATION_STYLE_LIST) {
      expect(fe.ANIMATION_STYLE_LABELS[s]).toBeTruthy();
    }
  });

  it('getAnimationMeta defaults for null/undefined/empty', () => {
    expect(fe.getAnimationMeta(null)).toEqual({ primary: null, tags: [], style: null });
    expect(fe.getAnimationMeta(undefined)).toEqual({ primary: null, tags: [], style: null });
    expect(fe.getAnimationMeta({})).toEqual({ primary: null, tags: [], style: null });
  });

  it('getAnimationMeta reads valid values', () => {
    const meta = fe.getAnimationMeta({
      animation_genre_primary: 'family_kids',
      animation_genre_tags: ['preschool', 'toyetic', 'INVALID_TAG'],
      animation_style: '2d',
    });
    expect(meta.primary).toBe('family_kids');
    expect(meta.tags).toEqual(['preschool', 'toyetic']); // invalid filtered
    expect(meta.style).toBe('2d');
  });

  it('getAnimationMeta rejects invalid primary/style', () => {
    const meta = fe.getAnimationMeta({
      animation_genre_primary: 'not_real',
      animation_style: 'watercolor',
    });
    expect(meta.primary).toBeNull();
    expect(meta.style).toBeNull();
  });

  it('setAnimationMeta merges without overwriting existing keys', () => {
    const existing = { production_modality: 'animation', some_key: 'value' };
    const result = fe.setAnimationMeta(existing, { primary: 'adult_animation', style: '3d' });
    expect(result.production_modality).toBe('animation');
    expect(result.some_key).toBe('value');
    expect(result.animation_genre_primary).toBe('adult_animation');
    expect(result.animation_style).toBe('3d');
  });

  it('buildAnimationMetaPromptBlock returns empty for live_action', () => {
    const meta = { primary: 'family_kids' as fe.AnimationPrimary, tags: ['toyetic'], style: '2d' as fe.AnimationStyle };
    expect(fe.buildAnimationMetaPromptBlock('live_action', meta)).toBe('');
  });

  it('buildAnimationMetaPromptBlock returns empty when no meta set', () => {
    expect(fe.buildAnimationMetaPromptBlock('animation', { primary: null, tags: [], style: null })).toBe('');
  });

  it('buildAnimationMetaPromptBlock returns block for animation with meta', () => {
    const block = fe.buildAnimationMetaPromptBlock('animation', {
      primary: 'sci_fi_cyber' as fe.AnimationPrimary,
      tags: ['cyberpunk', 'mecha'],
      style: '3d' as fe.AnimationStyle,
    });
    expect(block).toContain('ANIMATION METADATA');
    expect(block).toContain('Sci-Fi / Cyber');
    expect(block).toContain('3D / CGI');
    expect(block).toContain('cyberpunk, mecha');
  });
});
