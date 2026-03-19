/**
 * Prestige Style Contract — SINGLE SOURCE OF TRUTH for frontend.
 *
 * This file contains the EXACT same data as supabase/functions/_shared/prestigeStyleSystem.ts.
 * Any drift is caught by src/lib/images/__tests__/prestigeStyleContract.test.ts.
 *
 * DO NOT edit style/lane data here without also editing the canonical edge file.
 * The vitest contract validation will fail if they diverge.
 */

// ── Lane Grammar ────────────────────────────────────────────────────────────

export interface LaneGrammar {
  label: string;
  aspectRatio: string;
  allowedFraming: string[];
  forbiddenFraming: string[];
  promptDirectives: string;
  negativeDirectives: string;
  defaultStyle: string;
}

export const LANE_GRAMMARS: Record<string, LaneGrammar> = {
  vertical_drama: {
    label: 'Vertical Drama',
    aspectRatio: '9:16',
    allowedFraming: ['extreme_close_up', 'close_up', 'medium_close', 'medium', 'over_shoulder'],
    forbiddenFraming: ['wide_establishing', 'aerial', 'extreme_wide', 'panoramic'],
    defaultStyle: 'romantic_prestige',
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
    defaultStyle: 'natural_prestige',
    promptDirectives: 'Cinematic widescreen composition (16:9). Full range of shot types. Premium theatrical framing.',
    negativeDirectives: 'portrait orientation, vertical framing, phone-native, TikTok aesthetic',
  },
  series: {
    label: 'Series',
    aspectRatio: '16:9',
    allowedFraming: ['close_up', 'medium', 'wide', 'over_shoulder', 'two_shot'],
    forbiddenFraming: [],
    defaultStyle: 'natural_prestige',
    promptDirectives: 'Television cinematic composition (16:9). Character-driven framing with ensemble coverage.',
    negativeDirectives: 'portrait orientation, vertical framing',
  },
};

// ── Prestige Style Definitions ──────────────────────────────────────────────

export interface PrestigeStyleDef {
  key: string;
  label: string;
  description: string;
  lighting: string;
  palette: string;
  tone: string;
  compositionBias: string;
  texture: string;
  negatives: string[];
  swatchHsl: string;
}

export const PRESTIGE_STYLES: Record<string, PrestigeStyleDef> = {
  romantic_prestige: {
    key: 'romantic_prestige',
    label: 'Romantic Prestige',
    description: 'Warm golden light, intimate close-ups, soft-focus backgrounds. Bridgerton meets Wong Kar-wai.',
    lighting: 'Warm golden hour light, soft diffused key with gentle fill. Candle-warm practicals. Rim light separating subject from background.',
    palette: 'Warm ambers, deep rose, ivory, champagne gold. Muted jewel tones for accents. Skin tones rendered warm and luminous.',
    tone: 'Intimate, yearning, emotionally charged. Vulnerability and desire.',
    compositionBias: 'Tight framing on eyes and hands. Negative space used for emotional weight. Foreground blur elements for voyeuristic intimacy.',
    texture: 'Soft skin texture, fabric drape, candlelight flicker, condensation, flower petals.',
    negatives: ['harsh lighting', 'cold tones', 'industrial', 'sterile'],
    swatchHsl: '35 80% 55%',
  },
  cold_prestige: {
    key: 'cold_prestige',
    label: 'Cold Prestige',
    description: 'Steel blues, clinical precision, controlled power. Succession meets House of Cards.',
    lighting: 'Cool daylight through glass. Hard-edged key light with minimal fill. Corporate fluorescent undertone. Blown-out windows.',
    palette: 'Steel blue, slate grey, cold white, muted teal. Occasional accent of deep burgundy or black. Desaturated skin tones.',
    tone: 'Controlled, calculating, powerful. Tension beneath surface calm.',
    compositionBias: 'Centered power framing. Symmetry suggesting control. Reflective surfaces. Character isolated in frame.',
    texture: 'Polished surfaces, glass, steel, tailored fabric, sharp edges, architectural lines.',
    negatives: ['warm tones', 'soft glow', 'romantic', 'cozy'],
    swatchHsl: '210 40% 50%',
  },
  dark_prestige: {
    key: 'dark_prestige',
    label: 'Dark Prestige',
    description: 'Deep shadows, noir-inflected tension, moral ambiguity. Ozark meets Se7en.',
    lighting: 'Low-key with deep shadows. Single hard source with motivated practicals. Pools of light in darkness. Chiaroscuro.',
    palette: 'Near-black, deep forest green, dried blood red, gunmetal. Desaturated with occasional warm-cool contrast.',
    tone: 'Threatening, morally complex, suspenseful. Dread and consequence.',
    compositionBias: 'Shadow-heavy negative space. Subject partially obscured. Dutch angles for unease. Tight crops implying claustrophobia.',
    texture: 'Wet surfaces, rough concrete, worn leather, smoke, rain on glass, grain.',
    negatives: ['bright', 'cheerful', 'saturated colors', 'pastel'],
    swatchHsl: '150 20% 20%',
  },
  royal_prestige: {
    key: 'royal_prestige',
    label: 'Royal Prestige',
    description: 'Opulent, regal, historically rich. The Crown meets Versailles.',
    lighting: 'Motivated by chandeliers and tall windows. Warm interior light with cool daylight contrast. Volumetric light through dust.',
    palette: 'Deep gold, royal purple, emerald, ivory, burgundy. Rich saturated tones. Warm skin rendering.',
    tone: 'Majestic, weighty, ceremonial. Power and legacy.',
    compositionBias: 'Formal symmetry. Ornamental framing elements. Subject placed with architectural grandeur. Vertical lines of power.',
    texture: 'Velvet, brocade, gilt, marble, oil-painting-quality skin, crown jewels, polished wood.',
    negatives: ['casual', 'modern minimalist', 'stripped back', 'industrial'],
    swatchHsl: '45 70% 45%',
  },
  natural_prestige: {
    key: 'natural_prestige',
    label: 'Natural Prestige',
    description: 'Organic light, earthy tones, grounded realism. Normal People meets Nomadland.',
    lighting: 'Available natural light. Overcast softness or direct sun with real shadows. No artificial fill. Window light interiors.',
    palette: 'Earth tones — olive, terracotta, sand, stone grey, faded denim. Muted but true-to-life. Natural skin tones.',
    tone: 'Authentic, grounded, emotionally honest. Quiet intensity.',
    compositionBias: 'Observational framing. Subject slightly off-center. Breathing room. Handheld intimacy feel even if locked off.',
    texture: 'Weathered wood, raw linen, skin imperfections, natural hair, outdoor elements, grain.',
    negatives: ['artificial lighting', 'neon', 'synthetic', 'over-processed'],
    swatchHsl: '30 30% 50%',
  },
  hyper_stylized_prestige: {
    key: 'hyper_stylized_prestige',
    label: 'Hyper-Stylized Prestige',
    description: 'Bold color, graphic composition, heightened reality. Euphoria meets Pose.',
    lighting: 'Neon-motivated, colored gels, dramatic backlighting. Mixed color temperature. Theatrical spotlighting.',
    palette: 'Electric purple, hot pink, cyan, deep black. High saturation contrasts. Chromatic skin lighting.',
    tone: 'Heightened, expressive, unapologetic. Spectacle and identity.',
    compositionBias: 'Graphic framing. Bold symmetry or deliberate rule-breaking. Color-blocked zones. Subject as icon.',
    texture: 'Glitter, neon reflection, sequins, wet streets, chrome, holographic, synthetic fabrics.',
    negatives: ['naturalistic', 'documentary', 'understated', 'muted'],
    swatchHsl: '280 70% 50%',
  },
};

export const PRESTIGE_STYLE_KEYS = Object.keys(PRESTIGE_STYLES);
export type PrestigeStyleKey = keyof typeof PRESTIGE_STYLES;

// ── Shared Logic ────────────────────────────────────────────────────────────

/** Map project format strings to lane keys */
export function resolveFormatToLane(format: string): string {
  const f = (format || '').toLowerCase().replace(/[\s\-]+/g, '_');
  if (f.includes('vertical') || f.includes('short_form')) return 'vertical_drama';
  if (f.includes('feature') || f.includes('film')) return 'feature_film';
  if (f.includes('series') || f.includes('limited') || f.includes('tv')) return 'series';
  return 'feature_film';
}

/** Deterministic style precedence resolver */
export function resolvePrestigeStyle(opts: {
  sectionOverride?: string | null;
  uiSelection?: string | null;
  projectDefault?: string | null;
  laneKey?: string;
}): { styleKey: string; source: string } {
  if (opts.sectionOverride && PRESTIGE_STYLES[opts.sectionOverride]) {
    return { styleKey: opts.sectionOverride, source: 'section_override' };
  }
  if (opts.uiSelection && PRESTIGE_STYLES[opts.uiSelection]) {
    return { styleKey: opts.uiSelection, source: 'ui_selection' };
  }
  if (opts.projectDefault && PRESTIGE_STYLES[opts.projectDefault]) {
    return { styleKey: opts.projectDefault, source: 'project_default' };
  }
  const lane = opts.laneKey ? LANE_GRAMMARS[opts.laneKey] : null;
  if (lane?.defaultStyle && PRESTIGE_STYLES[lane.defaultStyle]) {
    return { styleKey: lane.defaultStyle, source: 'lane_default' };
  }
  return { styleKey: 'romantic_prestige', source: 'safe_default' };
}

/** Classify image for strict style filtering */
export function classifyImageForStyleFilter(
  image: { prestige_style?: string | null; lane_key?: string | null },
  activeStyleFilter: string | null,
  includeUntagged = false,
): boolean {
  if (!activeStyleFilter) return true;
  if (image.prestige_style === activeStyleFilter) return true;
  if (!image.prestige_style) return includeUntagged;
  return false;
}

// ── UI Helpers (frontend-only) ──────────────────────────────────────────────

export interface ComplianceResult {
  score: number;
  violations: string[];
  label: string;
}

export function validateLaneCompliance(
  image: { width?: number | null; height?: number | null; shot_type?: string | null },
  laneKey: string,
): ComplianceResult {
  const grammar = LANE_GRAMMARS[laneKey];
  if (!grammar) return { score: 100, violations: [], label: 'Unknown Lane' };

  const violations: string[] = [];
  let score = 100;

  if (image.width && image.height) {
    const ratio = image.width / image.height;
    const [aw, ah] = grammar.aspectRatio.split(':').map(Number);
    const expected = aw / ah;
    if (Math.abs(ratio - expected) > 0.12) {
      violations.push(`Aspect ratio ${ratio.toFixed(2)} violates ${grammar.aspectRatio}`);
      score -= 40;
    }
    if (laneKey === 'vertical_drama' && ratio > 1.0) {
      violations.push('Landscape orientation — vertical drama requires portrait');
      score -= 20;
    }
  }

  if (image.shot_type && grammar.forbiddenFraming.includes(image.shot_type)) {
    violations.push(`Shot type "${image.shot_type}" is forbidden in ${grammar.label}`);
    score -= 25;
  }

  if (image.shot_type && grammar.allowedFraming.length > 0 && !grammar.allowedFraming.includes(image.shot_type)) {
    violations.push(`Shot type "${image.shot_type}" is not preferred for ${grammar.label}`);
    score -= 15;
  }

  score = Math.max(0, score);
  const label = score >= 90 ? 'Compliant' : score >= 60 ? 'Partial' : 'Non-compliant';
  return { score, violations, label };
}

/** Get dimensions for a given aspect ratio */
export function getAspectDimensions(
  aspectRatio: string,
  maxDim = 1536,
): { width: number; height: number } {
  const [w, h] = aspectRatio.split(':').map(Number);
  if (!w || !h) return { width: 1024, height: 1536 };
  if (w > h) return { width: maxDim, height: Math.round((maxDim * h) / w) };
  return { width: Math.round((maxDim * w) / h), height: maxDim };
}
