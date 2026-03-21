/**
 * slideTypeConstraints — Visual guardrails per slide type.
 *
 * Returns positive framing directives and hard negative directives
 * to inject into every generation prompt, ensuring each slide
 * looks appropriate to its editorial purpose.
 */

export interface SlideTypeConstraints {
  /** Positive framing directives to append to prompt */
  positives: string[];
  /** Negative directives (things to avoid) */
  negatives: string[];
}

const CONSTRAINT_REGISTRY: Record<string, SlideTypeConstraints> = {
  cover: {
    positives: [
      'Cinematic hero composition, bold and iconic',
      'Strong visual hook, emotionally arresting',
    ],
    negatives: [
      'text overlay', 'logo', 'title card',
    ],
  },
  creative_statement: {
    positives: [
      'Wide environmental framing, atmospheric and tonal',
      'No protagonist focus — mood and world texture only',
      'Evocative landscape or interior establishing composition',
    ],
    negatives: [
      'close-up portrait', 'character confrontation', 'dialogue scene',
      'protagonist centered', 'character performing action', 'craft activity',
    ],
  },
  world: {
    positives: [
      'Empty or sparsely populated environment, architecture-first composition',
      'Location and geography dominant, no character focus',
      'Atmospheric depth and scale',
    ],
    negatives: [
      'character performing action', 'protagonist centered', 'character portrait',
      'craft activity', 'trade performance', 'close-up of person',
    ],
  },
  key_moments: {
    positives: [
      'Full narrative scene with dramatic staging and motivated action',
      'Characters in context, cinematic mise-en-scène with clear dramatic intent',
      'Dynamic composition with visible conflict, movement, or confrontation',
      'Distinct unique location and dramatic blocking per moment',
    ],
    negatives: [
      'empty landscape without characters', 'abstract texture',
      'static posing', 'abstract composition', 'symbolic imagery without characters',
      'relational power dynamic without action', 'group tableau without dramatic tension',
    ],
  },
  characters: {
    positives: [
      'Character-focused portrait or medium shot',
      'Clear face visibility with identity-defining features',
      'Cinematic character lighting',
    ],
    negatives: [
      'crowd scene', 'group shot with many faces', 'environment-only',
    ],
  },
  visual_language: {
    positives: [
      'Lighting study, texture reference, or composition demonstration',
      'Abstract or detail-focused, no narrative scene',
      'Material quality, surface detail, or color palette reference',
    ],
    negatives: [
      'main character focus', 'story moment', 'dialogue scene',
      'protagonist centered', 'narrative confrontation',
      'character performing action', 'craft activity',
    ],
  },
  themes: {
    positives: [
      'Symbolic imagery evoking emotional tone',
      'Abstract or metaphorical visual, not literal narrative',
      'Mood and atmosphere dominant',
    ],
    negatives: [
      'literal narrative scene', 'character dialogue',
      'action sequence', 'craft activity',
      'repeated room or workspace', 'trade performance',
    ],
  },
  story_engine: {
    positives: [
      'Relational tension composition showing power dynamics between characters',
      'Structured group composition revealing who controls whom',
      'Emotional pressure visible through body language and spatial relationships',
      'Interpersonal stakes visible in character blocking and framing',
    ],
    negatives: [
      'empty environment', 'texture study',
      'action beats with physical confrontation', 'chase or fight choreography',
      'environmental landscape without characters', 'symbolic abstract visuals',
    ],
  },
  comparables: {
    positives: [
      'Atmospheric background supporting context',
    ],
    negatives: [],
  },
  poster_directions: {
    positives: [
      'Key art composition suitable for marketing',
      'Bold, iconic, poster-worthy framing',
    ],
    negatives: [
      'casual snapshot', 'behind-the-scenes',
    ],
  },
  closing: {
    positives: [
      'Cinematic bookend, atmospheric and conclusive',
    ],
    negatives: [
      'text overlay', 'logo',
    ],
  },
};

/**
 * Get visual constraints for a slide type.
 * Returns empty arrays for unknown types (no constraint = no restriction).
 */
export function getSlideTypeConstraints(slideType: string): SlideTypeConstraints {
  return CONSTRAINT_REGISTRY[slideType] || { positives: [], negatives: [] };
}

/**
 * Build constraint text for prompt injection.
 * Returns a string to append to the generation prompt.
 */
export function buildConstraintPromptSuffix(slideType: string): string {
  const c = getSlideTypeConstraints(slideType);
  const parts: string[] = [];

  if (c.positives.length > 0) {
    parts.push(c.positives.join('. ') + '.');
  }
  if (c.negatives.length > 0) {
    parts.push('AVOID: ' + c.negatives.join(', ') + '.');
  }

  return parts.join(' ');
}
