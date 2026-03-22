/**
 * styleLock — Project-wide cinematic style lock for lookbook coherence.
 *
 * Defines and resolves the 6-axis cinematic style that ensures all
 * generated lookbook images feel like they come from one film.
 *
 * Persisted via project_visual_style.style_lock_json (additive field).
 */
import { supabase } from '@/integrations/supabase/client';

// ── Types ────────────────────────────────────────────────────────────────────

export type StyleColorProfile =
  | 'warm_filmic'
  | 'cool_noir'
  | 'neutral_cinematic';

export type StyleContrastCurve =
  | 'soft'
  | 'medium'
  | 'high';

export type StyleGrainLevel =
  | 'none'
  | 'light'
  | 'film_35mm';

export type StyleLensProfile =
  | 'anamorphic'
  | 'spherical'
  | 'portrait_85mm';

export type StyleLightingStyle =
  | 'naturalistic'
  | 'dramatic'
  | 'high_key'
  | 'low_key';

export type StyleTimeOfDayBias =
  | 'golden_hour'
  | 'daylight'
  | 'night'
  | 'mixed';

export interface StyleLock {
  color_profile: StyleColorProfile;
  contrast_curve: StyleContrastCurve;
  grain_level: StyleGrainLevel;
  lens_profile: StyleLensProfile;
  lighting_style: StyleLightingStyle;
  time_of_day_bias: StyleTimeOfDayBias;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export function getDefaultStyleLock(): StyleLock {
  return {
    color_profile: 'warm_filmic',
    contrast_curve: 'medium',
    grain_level: 'light',
    lens_profile: 'anamorphic',
    lighting_style: 'naturalistic',
    time_of_day_bias: 'mixed',
  };
}

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Serialize a StyleLock into a deterministic prompt directive block.
 */
export function serializeStyleLock(style: StyleLock): string {
  const COLOR_MAP: Record<StyleColorProfile, string> = {
    warm_filmic: 'Warm filmic color grading — amber highlights, rich shadows, Kodak warmth',
    cool_noir: 'Cool desaturated palette — blue-steel shadows, clinical highlights, noir tones',
    neutral_cinematic: 'Neutral cinematic color — balanced grading, natural skin tones, restrained palette',
  };
  const CONTRAST_MAP: Record<StyleContrastCurve, string> = {
    soft: 'Soft contrast curve — lifted shadows, gentle highlights, dreamy quality',
    medium: 'Medium contrast — balanced shadow/highlight ratio, cinematic dynamic range',
    high: 'High contrast — deep blacks, bright highlights, dramatic tonal separation',
  };
  const GRAIN_MAP: Record<StyleGrainLevel, string> = {
    none: 'Clean digital capture — no visible grain',
    light: 'Light organic film grain — subtle texture without distraction',
    film_35mm: 'Pronounced 35mm film grain — visible texture, analog character, photochemical feel',
  };
  const LENS_MAP: Record<StyleLensProfile, string> = {
    anamorphic: 'Anamorphic lens characteristics — oval bokeh, horizontal flares, wide field compression',
    spherical: 'Spherical lens — clean bokeh circles, natural perspective, minimal distortion',
    portrait_85mm: '85mm portrait lens — compressed background, creamy bokeh, flattering perspective',
  };
  const LIGHTING_MAP: Record<StyleLightingStyle, string> = {
    naturalistic: 'Naturalistic lighting — motivated sources, available light feel, gentle fill',
    dramatic: 'Dramatic lighting — strong key-to-fill ratio, sculpted shadows, chiaroscuro influence',
    high_key: 'High-key lighting — even illumination, minimal shadows, bright and airy',
    low_key: 'Low-key lighting — dominant shadows, selective illumination, mystery and tension',
  };
  const TOD_MAP: Record<StyleTimeOfDayBias, string> = {
    golden_hour: 'Golden hour bias — warm directional light, long shadows, amber atmosphere',
    daylight: 'Daylight bias — overhead natural light, clear visibility, neutral temperature',
    night: 'Night bias — artificial/moonlit sources, cool tones, pools of light in darkness',
    mixed: 'Mixed time-of-day — varied lighting scenarios appropriate to each scene',
  };

  return [
    '[CINEMATIC STYLE LOCK — ALL IMAGES MUST MATCH]',
    '',
    `COLOR: ${COLOR_MAP[style.color_profile]}`,
    `CONTRAST: ${CONTRAST_MAP[style.contrast_curve]}`,
    `GRAIN: ${GRAIN_MAP[style.grain_level]}`,
    `LENS: ${LENS_MAP[style.lens_profile]}`,
    `LIGHTING: ${LIGHTING_MAP[style.lighting_style]}`,
    `TIME OF DAY: ${TOD_MAP[style.time_of_day_bias]}`,
    '',
    'Every image in this project MUST share these visual characteristics.',
    'Maintain consistent photographic language across all outputs.',
  ].join('\n');
}

/**
 * Compute a short deterministic hash for style lock comparison.
 */
export function hashStyleLock(style: StyleLock): string {
  return [
    style.color_profile,
    style.contrast_curve,
    style.grain_level,
    style.lens_profile,
    style.lighting_style,
    style.time_of_day_bias,
  ].join('|');
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Resolve the project's cinematic style lock.
 * Reads from project_visual_style.style_lock_json if available,
 * otherwise returns defaults.
 */
export async function resolveProjectStyleLock(projectId: string): Promise<StyleLock> {
  try {
    const { data } = await (supabase as any)
      .from('project_visual_style')
      .select('style_lock_json')
      .eq('project_id', projectId)
      .maybeSingle();

    if (data?.style_lock_json && typeof data.style_lock_json === 'object') {
      const raw = data.style_lock_json as Record<string, unknown>;
      const defaults = getDefaultStyleLock();
      return {
        color_profile: (raw.color_profile as StyleColorProfile) || defaults.color_profile,
        contrast_curve: (raw.contrast_curve as StyleContrastCurve) || defaults.contrast_curve,
        grain_level: (raw.grain_level as StyleGrainLevel) || defaults.grain_level,
        lens_profile: (raw.lens_profile as StyleLensProfile) || defaults.lens_profile,
        lighting_style: (raw.lighting_style as StyleLightingStyle) || defaults.lighting_style,
        time_of_day_bias: (raw.time_of_day_bias as StyleTimeOfDayBias) || defaults.time_of_day_bias,
      };
    }
  } catch (err) {
    console.warn('[StyleLock] Failed to load project style lock:', err);
  }
  return getDefaultStyleLock();
}

/**
 * Save the cinematic style lock for a project.
 */
export async function saveProjectStyleLock(projectId: string, style: StyleLock): Promise<void> {
  const { data: existing } = await (supabase as any)
    .from('project_visual_style')
    .select('id')
    .eq('project_id', projectId)
    .maybeSingle();

  if (existing?.id) {
    await (supabase as any)
      .from('project_visual_style')
      .update({ style_lock_json: style })
      .eq('id', existing.id);
  } else {
    const { data: user } = await supabase.auth.getUser();
    await (supabase as any)
      .from('project_visual_style')
      .insert({
        project_id: projectId,
        style_lock_json: style,
        created_by: user?.user?.id || null,
      });
  }
}
