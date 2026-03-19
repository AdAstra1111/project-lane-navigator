/**
 * Prestige Vertical Style Registry — Decoupled lane grammar + style overlays.
 *
 * Lane grammar = format-level constraints (framing, composition, aspect ratio).
 * Style overlay = lighting, color, tone, emotional palette.
 *
 * Style NEVER overrides lane constraints. Lane grammar is always enforced first,
 * then style directives are layered on top.
 */

// ── Lane Grammar ────────────────────────────────────────────────────────────

export interface LaneGrammar {
  /** Display label */
  label: string;
  /** Enforced aspect ratio */
  aspectRatio: string;
  /** Allowed framing types */
  allowedFraming: string[];
  /** Forbidden framing types */
  forbiddenFraming: string[];
  /** Prompt directives injected for every generation in this lane */
  promptDirectives: string;
  /** Negative prompt constraints */
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
    promptDirectives: 'Cinematic widescreen composition (16:9). Full range of shot types permitted. Premium theatrical framing.',
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

// ── Prestige Style Overlays ─────────────────────────────────────────────────

export interface PrestigeStyle {
  /** Unique key */
  key: string;
  /** Display label */
  label: string;
  /** Short description */
  description: string;
  /** Lighting directives */
  lighting: string;
  /** Color palette directives */
  palette: string;
  /** Emotional tone */
  tone: string;
  /** Composition bias (layered on top of lane grammar, never overriding) */
  compositionBias: string;
  /** Texture/materiality hints */
  texture: string;
  /** Prompt block assembled from all style fields */
  promptBlock: string;
  /** Negative prompt additions */
  negativeBlock: string;
  /** Preview color swatch (HSL) for UI badges */
  swatchHsl: string;
}

function buildStyle(partial: Omit<PrestigeStyle, 'promptBlock' | 'negativeBlock'>): PrestigeStyle {
  const promptBlock = [
    `[PRESTIGE STYLE: ${partial.label.toUpperCase()}]`,
    `Lighting: ${partial.lighting}`,
    `Color Palette: ${partial.palette}`,
    `Tone: ${partial.tone}`,
    `Composition Bias: ${partial.compositionBias}`,
    `Texture: ${partial.texture}`,
  ].join('\n');

  const negativeBlock = buildNegatives(partial.key);

  return { ...partial, promptBlock, negativeBlock };
}

function buildNegatives(key: string): string {
  const base = ['flat lighting', 'stock photo', 'generic', 'amateur'];
  const specifics: Record<string, string[]> = {
    romantic_prestige: ['harsh lighting', 'cold tones', 'industrial', 'sterile'],
    cold_prestige: ['warm tones', 'soft glow', 'romantic', 'cozy'],
    dark_prestige: ['bright', 'cheerful', 'saturated colors', 'pastel'],
    royal_prestige: ['casual', 'modern minimalist', 'stripped back', 'industrial'],
    natural_prestige: ['artificial lighting', 'neon', 'synthetic', 'over-processed'],
    hyper_stylized_prestige: ['naturalistic', 'documentary', 'understated', 'muted'],
  };
  return [...base, ...(specifics[key] || [])].join(', ');
}

export const PRESTIGE_STYLES: Record<string, PrestigeStyle> = {
  romantic_prestige: buildStyle({
    key: 'romantic_prestige',
    label: 'Romantic Prestige',
    description: 'Warm golden light, intimate close-ups, soft-focus backgrounds. Bridgerton meets Wong Kar-wai.',
    lighting: 'Warm golden hour light, soft diffused key with gentle fill. Candle-warm practicals. Rim light separating subject from background.',
    palette: 'Warm ambers, deep rose, ivory, champagne gold. Muted jewel tones for accents. Skin tones rendered warm and luminous.',
    tone: 'Intimate, yearning, emotionally charged. Vulnerability and desire.',
    compositionBias: 'Tight framing on eyes and hands. Negative space used for emotional weight. Foreground blur elements for voyeuristic intimacy.',
    texture: 'Soft skin texture, fabric drape, candlelight flicker, condensation, flower petals.',
    swatchHsl: '35 80% 55%',
  }),
  cold_prestige: buildStyle({
    key: 'cold_prestige',
    label: 'Cold Prestige',
    description: 'Steel blues, clinical precision, controlled power. Succession meets House of Cards.',
    lighting: 'Cool daylight through glass. Hard-edged key light with minimal fill. Corporate fluorescent undertone. Blown-out windows.',
    palette: 'Steel blue, slate grey, cold white, muted teal. Occasional accent of deep burgundy or black. Desaturated skin tones.',
    tone: 'Controlled, calculating, powerful. Tension beneath surface calm.',
    compositionBias: 'Centered power framing. Symmetry suggesting control. Reflective surfaces. Character isolated in frame.',
    texture: 'Polished surfaces, glass, steel, tailored fabric, sharp edges, architectural lines.',
    swatchHsl: '210 40% 50%',
  }),
  dark_prestige: buildStyle({
    key: 'dark_prestige',
    label: 'Dark Prestige',
    description: 'Deep shadows, noir-inflected tension, moral ambiguity. Ozark meets Se7en.',
    lighting: 'Low-key with deep shadows. Single hard source with motivated practicals. Pools of light in darkness. Chiaroscuro.',
    palette: 'Near-black, deep forest green, dried blood red, gunmetal. Desaturated with occasional warm-cool contrast.',
    tone: 'Threatening, morally complex, suspenseful. Dread and consequence.',
    compositionBias: 'Shadow-heavy negative space. Subject partially obscured. Dutch angles for unease. Tight crops implying claustrophobia.',
    texture: 'Wet surfaces, rough concrete, worn leather, smoke, rain on glass, grain.',
    swatchHsl: '150 20% 20%',
  }),
  royal_prestige: buildStyle({
    key: 'royal_prestige',
    label: 'Royal Prestige',
    description: 'Opulent, regal, historically rich. The Crown meets Versailles.',
    lighting: 'Motivated by chandeliers and tall windows. Warm interior light with cool daylight contrast. Volumetric light through dust.',
    palette: 'Deep gold, royal purple, emerald, ivory, burgundy. Rich saturated tones. Warm skin rendering.',
    tone: 'Majestic, weighty, ceremonial. Power and legacy.',
    compositionBias: 'Formal symmetry. Ornamental framing elements. Subject placed with architectural grandeur. Vertical lines of power.',
    texture: 'Velvet, brocade, gilt, marble, oil-painting-quality skin, crown jewels, polished wood.',
    swatchHsl: '45 70% 45%',
  }),
  natural_prestige: buildStyle({
    key: 'natural_prestige',
    label: 'Natural Prestige',
    description: 'Organic light, earthy tones, grounded realism. Normal People meets Nomadland.',
    lighting: 'Available natural light. Overcast softness or direct sun with real shadows. No artificial fill. Window light interiors.',
    palette: 'Earth tones — olive, terracotta, sand, stone grey, faded denim. Muted but true-to-life. Natural skin tones.',
    tone: 'Authentic, grounded, emotionally honest. Quiet intensity.',
    compositionBias: 'Observational framing. Subject slightly off-center. Breathing room. Handheld intimacy feel even if locked off.',
    texture: 'Weathered wood, raw linen, skin imperfections, natural hair, outdoor elements, grain.',
    swatchHsl: '30 30% 50%',
  }),
  hyper_stylized_prestige: buildStyle({
    key: 'hyper_stylized_prestige',
    label: 'Hyper-Stylized Prestige',
    description: 'Bold color, graphic composition, heightened reality. Euphoria meets Pose.',
    lighting: 'Neon-motivated, colored gels, dramatic backlighting. Mixed color temperature. Theatrical spotlighting.',
    palette: 'Electric purple, hot pink, cyan, deep black. High saturation contrasts. Chromatic skin lighting.',
    tone: 'Heightened, expressive, unapologetic. Spectacle and identity.',
    compositionBias: 'Graphic framing. Bold symmetry or deliberate rule-breaking. Color-blocked zones. Subject as icon.',
    texture: 'Glitter, neon reflection, sequins, wet streets, chrome, holographic, synthetic fabrics.',
    swatchHsl: '280 70% 50%',
  }),
};

export const PRESTIGE_STYLE_KEYS = Object.keys(PRESTIGE_STYLES) as PrestigeStyleKey[];
export type PrestigeStyleKey = keyof typeof PRESTIGE_STYLES;

// ── Composite Prompt Assembly ───────────────────────────────────────────────

export interface StyleComposite {
  /** Combined lane + style prompt block */
  promptBlock: string;
  /** Combined negative block */
  negativeBlock: string;
  /** Lane grammar used */
  laneKey: string;
  /** Style used */
  styleKey: string;
  /** Enforced aspect ratio */
  aspectRatio: string;
}

/**
 * Assemble a composite prompt from lane grammar + style overlay.
 * Lane grammar is ALWAYS first and mandatory. Style layers on top.
 */
export function assembleStyleComposite(
  laneKey: string,
  styleKey: string,
): StyleComposite {
  const grammar = LANE_GRAMMARS[laneKey] ?? LANE_GRAMMARS.vertical_drama;
  const style = PRESTIGE_STYLES[styleKey] ?? PRESTIGE_STYLES.romantic_prestige;

  const promptBlock = [
    `[LANE GRAMMAR — ${grammar.label.toUpperCase()} — MANDATORY]`,
    grammar.promptDirectives,
    '',
    style.promptBlock,
  ].join('\n');

  const negativeBlock = [grammar.negativeDirectives, style.negativeBlock]
    .filter(Boolean)
    .join(', ');

  return {
    promptBlock,
    negativeBlock,
    laneKey,
    styleKey,
    aspectRatio: grammar.aspectRatio,
  };
}

/**
 * Get the dimensions for a given aspect ratio at a target resolution.
 */
export function getAspectDimensions(
  aspectRatio: string,
  maxDim = 1536,
): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  if (!w || !h) return { width: 1024, height: 1536 };
  
  if (w > h) {
    return { width: maxDim, height: Math.round((maxDim * h) / w) };
  }
  return { width: Math.round((maxDim * w) / h), height: maxDim };
}

/**
 * Validate that an image's metadata is compliant with a lane grammar.
 * Returns a score 0–100 and list of violations.
 */
export function validateLaneCompliance(
  image: { width?: number | null; height?: number | null; shot_type?: string | null },
  laneKey: string,
): { score: number; violations: string[] } {
  const grammar = LANE_GRAMMARS[laneKey];
  if (!grammar) return { score: 100, violations: [] };

  const violations: string[] = [];

  // Aspect ratio check
  if (image.width && image.height) {
    const ratio = image.width / image.height;
    const [aw, ah] = grammar.aspectRatio.split(':').map(Number);
    const expected = aw / ah;
    const tolerance = 0.15;
    if (Math.abs(ratio - expected) > tolerance) {
      violations.push(`Aspect ratio ${ratio.toFixed(2)} does not match ${grammar.aspectRatio} (expected ~${expected.toFixed(2)})`);
    }
  }

  // Forbidden framing check
  if (image.shot_type && grammar.forbiddenFraming.includes(image.shot_type)) {
    violations.push(`Shot type "${image.shot_type}" is forbidden in ${grammar.label}`);
  }

  const score = Math.max(0, 100 - violations.length * 30);
  return { score, violations };
}
