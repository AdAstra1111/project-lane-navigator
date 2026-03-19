/**
 * Global Image Style Policy — Single source of truth for visual rendering mode.
 *
 * DEFAULT: Photorealistic cinematic imagery.
 * STYLISED: Explicit opt-in only, justified by project canon/format/genre.
 *
 * Used by: Poster Engine, Look Book, Canon Image System, any future generation.
 */

export type ImageStyleMode =
  | 'photorealistic_cinematic'   // DEFAULT — theatrical, premium, believable
  | 'stylised_animation'         // Animation projects
  | 'stylised_graphic'           // Graphic novel / comic adaptations
  | 'stylised_experimental'      // Deliberate artistic choice via creative framing
  | 'stylised_period_painterly'; // Period pieces with intentional painterly treatment

export interface ImageStylePolicy {
  /** Active style mode */
  mode: ImageStyleMode;
  /** Why this mode was selected */
  rationale: string;
  /** Positive style directives injected into prompts */
  styleDirectives: string;
  /** Negative constraints injected into prompts */
  negativeStyleConstraints: string;
  /** Whether this is the default or an explicit override */
  isDefault: boolean;
}

/** Formats that justify stylised rendering */
const ANIMATION_FORMATS = ['animation', 'anim-feature', 'anim-series', 'animated'];
const GRAPHIC_GENRES = ['graphic-novel', 'comic', 'manga', 'anime'];

// ── Core style blocks ────────────────────────────────────────────────────────

const PHOTOREAL_DIRECTIVES = [
  'Photorealistic cinematic imagery',
  'Shot on high-end cinema camera (ARRI Alexa / RED Monstro aesthetic)',
  'Real-world materials, textures, and surfaces',
  'Believable natural or motivated lighting',
  'Cinematic depth of field with professional lens characteristics',
  'Grounded, tactile, physically plausible composition',
  'Premium theatrical realism — this should look like a still from a major motion picture',
].join('. ');

const PHOTOREAL_NEGATIVES = [
  'painterly', 'illustrative', 'cartoon', 'anime', 'graphic-novel style',
  'concept art rendering', 'abstract', 'surreal', 'watercolor',
  'oil painting', 'sketch', 'line art', 'cel-shaded', 'pop art',
  'storybook illustration', 'digital painting', 'CGI render look',
  'overly stylised', 'artificial looking', 'plastic skin texture',
  'uncanny valley', 'stock photo aesthetic',
].join(', ');

const ANIMATION_DIRECTIVES = [
  'Stylised animated visual language appropriate to the project',
  'Bold shapes, expressive character design, intentional color palette',
  'Professional animation studio quality (Pixar / Studio Ghibli / Spider-Verse tier)',
].join('. ');

const ANIMATION_NEGATIVES = [
  'photorealistic', 'live-action', 'stock photo',
  'uncanny valley', 'cheap CGI', 'low-quality render',
].join(', ');

const GRAPHIC_DIRECTIVES = [
  'Graphic novel / comic book visual style',
  'Bold ink work, dramatic panel composition, strong graphic contrasts',
  'Professional comic art quality',
].join('. ');

const GRAPHIC_NEGATIVES = [
  'photorealistic', 'live-action', 'stock photo', 'cheap clip art',
].join(', ');

const EXPERIMENTAL_DIRECTIVES = [
  'Artistic, boundary-pushing visual language as specified by the creative brief',
  'Intentional stylisation that serves the project vision',
  'High production value regardless of style choice',
].join('. ');

const EXPERIMENTAL_NEGATIVES = [
  'generic', 'stock photo', 'cheap', 'low quality', 'amateur',
].join(', ');

// ── Resolver ─────────────────────────────────────────────────────────────────

/**
 * Resolve the image style policy for a project.
 * Returns photorealistic cinematic by default.
 * Only returns stylised modes when project attributes explicitly justify it.
 */
export function resolveImageStylePolicy(
  projectMeta: {
    format?: string;
    genres?: string[];
    tone?: string;
    assignedLane?: string;
  },
  explicitOverride?: ImageStyleMode,
): ImageStylePolicy {
  // 1. Explicit override (e.g., from creative framing selection)
  if (explicitOverride && explicitOverride !== 'photorealistic_cinematic') {
    return buildPolicy(explicitOverride, `Explicit creative direction override: ${explicitOverride}`, false);
  }

  const format = (projectMeta.format || '').toLowerCase();
  const genres = (projectMeta.genres || []).map(g => g.toLowerCase());

  // 2. Animation format → stylised animation
  if (ANIMATION_FORMATS.some(af => format.includes(af))) {
    return buildPolicy('stylised_animation', `Project format "${format}" is animation — stylised rendering appropriate`, false);
  }

  // 3. Graphic novel / manga / comic genre → stylised graphic
  if (genres.some(g => GRAPHIC_GENRES.some(gg => g.includes(gg)))) {
    return buildPolicy('stylised_graphic', `Project genre includes graphic/comic — stylised rendering appropriate`, false);
  }

  // 4. Default: photorealistic cinematic
  return buildPolicy(
    'photorealistic_cinematic',
    'Default policy — photorealistic cinematic is the standard for premium visual output',
    true,
  );
}

function buildPolicy(mode: ImageStyleMode, rationale: string, isDefault: boolean): ImageStylePolicy {
  switch (mode) {
    case 'stylised_animation':
      return { mode, rationale, isDefault, styleDirectives: ANIMATION_DIRECTIVES, negativeStyleConstraints: ANIMATION_NEGATIVES };
    case 'stylised_graphic':
      return { mode, rationale, isDefault, styleDirectives: GRAPHIC_DIRECTIVES, negativeStyleConstraints: GRAPHIC_NEGATIVES };
    case 'stylised_experimental':
    case 'stylised_period_painterly':
      return { mode, rationale, isDefault, styleDirectives: EXPERIMENTAL_DIRECTIVES, negativeStyleConstraints: EXPERIMENTAL_NEGATIVES };
    default:
      return { mode: 'photorealistic_cinematic', rationale, isDefault, styleDirectives: PHOTOREAL_DIRECTIVES, negativeStyleConstraints: PHOTOREAL_NEGATIVES };
  }
}

/**
 * Format the style policy into a prompt block for injection into image generation prompts.
 */
export function formatStylePolicyPromptBlock(policy: ImageStylePolicy): string {
  return [
    '[IMAGE STYLE POLICY — MANDATORY]',
    `Mode: ${policy.mode.replace(/_/g, ' ').toUpperCase()}`,
    `Directives: ${policy.styleDirectives}`,
    `DO NOT render in these styles: ${policy.negativeStyleConstraints}`,
  ].join('\n');
}

/**
 * Get the negative prompt additions from the style policy.
 */
export function getStylePolicyNegatives(policy: ImageStylePolicy): string {
  return policy.negativeStyleConstraints;
}
