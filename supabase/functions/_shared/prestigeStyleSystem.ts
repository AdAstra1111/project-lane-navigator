/**
 * Prestige Vertical Style System — Edge function shared module.
 *
 * Provides lane grammar + style overlay prompt assembly for image generation.
 * Must be imported by all image generation edge functions.
 */

// ── Lane Grammar ────────────────────────────────────────────────────────────

export interface LaneGrammar {
  label: string;
  aspectRatio: string;
  allowedFraming: string[];
  forbiddenFraming: string[];
  promptDirectives: string;
  negativeDirectives: string;
}

export const LANE_GRAMMARS: Record<string, LaneGrammar> = {
  vertical_drama: {
    label: 'Vertical Drama',
    aspectRatio: '9:16',
    allowedFraming: ['extreme_close_up', 'close_up', 'medium_close', 'medium', 'over_shoulder'],
    forbiddenFraming: ['wide_establishing', 'aerial', 'extreme_wide', 'panoramic'],
    promptDirectives: [
      'MANDATORY: Portrait orientation (9:16 aspect ratio)',
      'Character-first composition — subject fills at least 60% of frame',
      'Close or medium-close framing only',
      'Intimate, phone-native visual language',
      'Shallow depth of field with subject separation',
      'No wide establishing shots, no aerial views, no panoramic compositions',
      'Shot must feel native to vertical mobile viewing',
    ].join('. '),
    negativeDirectives: [
      'wide shot', 'establishing shot', 'aerial view', 'panoramic',
      'landscape orientation', 'horizontal framing', 'cinema widescreen',
      '16:9', '2.39:1', 'letterbox', 'tiny figures in landscape',
    ].join(', '),
  },
  feature_film: {
    label: 'Feature Film',
    aspectRatio: '16:9',
    allowedFraming: ['close_up', 'medium', 'wide', 'establishing', 'aerial', 'tableau'],
    forbiddenFraming: [],
    promptDirectives: 'Cinematic widescreen composition (16:9). Full range of shot types. Premium theatrical framing.',
    negativeDirectives: 'portrait orientation, vertical framing, phone-native, TikTok aesthetic',
  },
  series: {
    label: 'Series',
    aspectRatio: '16:9',
    allowedFraming: ['close_up', 'medium', 'wide', 'over_shoulder', 'two_shot'],
    forbiddenFraming: [],
    promptDirectives: 'Television cinematic composition (16:9). Character-driven framing with ensemble coverage.',
    negativeDirectives: 'portrait orientation, vertical framing',
  },
};

// ── Prestige Style Definitions ──────────────────────────────────────────────

export interface PrestigeStyleDef {
  key: string;
  label: string;
  lighting: string;
  palette: string;
  tone: string;
  compositionBias: string;
  texture: string;
}

const STYLES: Record<string, PrestigeStyleDef> = {
  romantic_prestige: {
    key: 'romantic_prestige',
    label: 'Romantic Prestige',
    lighting: 'Warm golden hour light, soft diffused key with gentle fill. Candle-warm practicals. Rim light separating subject from background.',
    palette: 'Warm ambers, deep rose, ivory, champagne gold. Muted jewel tones for accents. Skin tones rendered warm and luminous.',
    tone: 'Intimate, yearning, emotionally charged. Vulnerability and desire.',
    compositionBias: 'Tight framing on eyes and hands. Negative space used for emotional weight. Foreground blur elements for voyeuristic intimacy.',
    texture: 'Soft skin texture, fabric drape, candlelight flicker, condensation, flower petals.',
  },
  cold_prestige: {
    key: 'cold_prestige',
    label: 'Cold Prestige',
    lighting: 'Cool daylight through glass. Hard-edged key light with minimal fill. Corporate fluorescent undertone.',
    palette: 'Steel blue, slate grey, cold white, muted teal. Occasional accent of deep burgundy or black.',
    tone: 'Controlled, calculating, powerful. Tension beneath surface calm.',
    compositionBias: 'Centered power framing. Symmetry suggesting control. Reflective surfaces.',
    texture: 'Polished surfaces, glass, steel, tailored fabric, sharp edges.',
  },
  dark_prestige: {
    key: 'dark_prestige',
    label: 'Dark Prestige',
    lighting: 'Low-key with deep shadows. Single hard source with motivated practicals. Chiaroscuro.',
    palette: 'Near-black, deep forest green, dried blood red, gunmetal. Desaturated.',
    tone: 'Threatening, morally complex, suspenseful. Dread and consequence.',
    compositionBias: 'Shadow-heavy negative space. Subject partially obscured. Dutch angles for unease.',
    texture: 'Wet surfaces, rough concrete, worn leather, smoke, rain on glass, grain.',
  },
  royal_prestige: {
    key: 'royal_prestige',
    label: 'Royal Prestige',
    lighting: 'Motivated by chandeliers and tall windows. Warm interior with cool daylight contrast. Volumetric light.',
    palette: 'Deep gold, royal purple, emerald, ivory, burgundy. Rich saturated tones.',
    tone: 'Majestic, weighty, ceremonial. Power and legacy.',
    compositionBias: 'Formal symmetry. Ornamental framing elements. Vertical lines of power.',
    texture: 'Velvet, brocade, gilt, marble, polished wood.',
  },
  natural_prestige: {
    key: 'natural_prestige',
    label: 'Natural Prestige',
    lighting: 'Available natural light. Overcast softness or direct sun with real shadows. No artificial fill.',
    palette: 'Earth tones — olive, terracotta, sand, stone grey, faded denim.',
    tone: 'Authentic, grounded, emotionally honest. Quiet intensity.',
    compositionBias: 'Observational framing. Subject slightly off-center. Breathing room.',
    texture: 'Weathered wood, raw linen, skin imperfections, natural hair, grain.',
  },
  hyper_stylized_prestige: {
    key: 'hyper_stylized_prestige',
    label: 'Hyper-Stylized Prestige',
    lighting: 'Neon-motivated, colored gels, dramatic backlighting. Mixed color temperature. Theatrical spotlighting.',
    palette: 'Electric purple, hot pink, cyan, deep black. High saturation contrasts.',
    tone: 'Heightened, expressive, unapologetic. Spectacle and identity.',
    compositionBias: 'Graphic framing. Bold symmetry or deliberate rule-breaking. Color-blocked zones.',
    texture: 'Glitter, neon reflection, sequins, wet streets, chrome, holographic.',
  },
};

// ── Composite Prompt Assembly ───────────────────────────────────────────────

export interface StyleComposite {
  promptBlock: string;
  negativeBlock: string;
  laneKey: string;
  styleKey: string;
  aspectRatio: string;
  width: number;
  height: number;
}

/**
 * Assemble composite prompt from lane grammar + style overlay.
 * Lane grammar is ALWAYS mandatory and first. Style layers on top.
 */
export function assemblePrestigePrompt(
  laneKey: string,
  styleKey: string,
  maxDim = 1536,
): StyleComposite {
  const grammar = LANE_GRAMMARS[laneKey] ?? LANE_GRAMMARS.vertical_drama;
  const style = STYLES[styleKey] ?? STYLES.romantic_prestige;

  const styleBlock = [
    `[PRESTIGE STYLE: ${style.label.toUpperCase()}]`,
    `Lighting: ${style.lighting}`,
    `Color Palette: ${style.palette}`,
    `Tone: ${style.tone}`,
    `Composition Bias: ${style.compositionBias}`,
    `Texture: ${style.texture}`,
  ].join('\n');

  const promptBlock = [
    `[LANE GRAMMAR — ${grammar.label.toUpperCase()} — MANDATORY]`,
    grammar.promptDirectives,
    '',
    styleBlock,
  ].join('\n');

  const negatives = [
    grammar.negativeDirectives,
    'flat lighting, stock photo, generic, amateur',
  ].join(', ');

  // Calculate dimensions
  const [w, h] = grammar.aspectRatio.split(':').map(Number);
  let width: number, height: number;
  if (w > h) {
    width = maxDim;
    height = Math.round((maxDim * h) / w);
  } else {
    height = maxDim;
    width = Math.round((maxDim * w) / h);
  }

  return { promptBlock, negativeBlock: negatives, laneKey, styleKey, aspectRatio: grammar.aspectRatio, width, height };
}
