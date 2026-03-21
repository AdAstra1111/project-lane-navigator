/**
 * Slot Prompt Registry — Maps (slot_type + shot_type + subject_type) to prompt templates.
 * 
 * Generates structured prompts for the generate-lookbook-image edge function.
 * Prevents generic/irrelevant imagery by enforcing context relevance.
 * 
 * Templates use [PLACEHOLDER] tokens replaced at generation time.
 */

export interface PromptTemplate {
  /** Unique key for this template */
  key: string;
  /** Structured prompt with placeholders */
  template: string;
  /** Negative prompt additions */
  negativeAdditions: string[];
  /** Required context fields */
  requiredContext: string[];
}

export interface PromptContext {
  projectTitle?: string;
  genre?: string;
  tone?: string;
  period?: string;
  characterName?: string;
  characterRole?: string;
  characterTraits?: string;
  locationName?: string;
  locationDescription?: string;
  worldRules?: string;
  momentDescription?: string;
  costumeNotes?: string;
  theme?: string;
}

// ── Template Registry ────────────────────────────────────────────────────────

const TEMPLATES: Record<string, PromptTemplate> = {
  // World / Location templates
  world_wide_establishing: {
    key: 'world_wide_establishing',
    template: 'Cinematic wide establishing shot of [LOCATION], [PERIOD_CONTEXT]. Atmospheric natural lighting, vast depth of field, environmental storytelling. No characters visible. [WORLD_RULES]. Film still quality, anamorphic lens, 16:9 composition.',
    negativeAdditions: ['people', 'characters', 'text', 'watermark', 'modern technology unless period-appropriate'],
    requiredContext: ['locationName'],
  },

  world_atmospheric: {
    key: 'world_atmospheric',
    template: 'Atmospheric environment shot capturing the mood of [LOCATION]. [TONE_CONTEXT]. Natural light, environmental texture, cinematic depth. No characters. [WORLD_RULES]. Film still quality.',
    negativeAdditions: ['people', 'characters', 'text', 'watermark'],
    requiredContext: ['locationName'],
  },

  world_detail: {
    key: 'world_detail',
    template: 'Close-up environmental detail shot from [LOCATION]. Texture-rich, tactile, production design quality. [PERIOD_CONTEXT]. Shallow depth of field, natural light. [WORLD_RULES].',
    negativeAdditions: ['people', 'faces', 'text'],
    requiredContext: ['locationName'],
  },

  // Character templates
  character_close_up: {
    key: 'character_close_up',
    template: 'Cinematic portrait close-up of [CHARACTER_NAME], [CHARACTER_ROLE]. [CHARACTER_TRAITS]. [COSTUME_NOTES]. [TONE_CONTEXT]. Identity-consistent, naturalistic lighting, film still quality. Shallow depth of field.',
    negativeAdditions: ['multiple people', 'text', 'watermark', 'AI-generated look', 'plastic skin'],
    requiredContext: ['characterName'],
  },

  character_medium: {
    key: 'character_medium',
    template: 'Medium shot of [CHARACTER_NAME], [CHARACTER_ROLE], in context. [COSTUME_NOTES]. [TONE_CONTEXT]. Environmental context visible, character occupying the space authentically. Film still quality.',
    negativeAdditions: ['text', 'watermark', 'AI-generated look'],
    requiredContext: ['characterName'],
  },

  character_full_body: {
    key: 'character_full_body',
    template: 'Full body shot of [CHARACTER_NAME], [CHARACTER_ROLE]. [CHARACTER_TRAITS]. [COSTUME_NOTES]. [PERIOD_CONTEXT]. Standing or in natural pose, full costume visible. Environmental context. Film still quality.',
    negativeAdditions: ['text', 'watermark', 'cropped body'],
    requiredContext: ['characterName'],
  },

  // Atmosphere / Tone templates
  atmosphere_lighting: {
    key: 'atmosphere_lighting',
    template: 'Atmospheric scene evoking [TONE_CONTEXT]. [PERIOD_CONTEXT]. Cinematic lighting study — the mood of [PROJECT_TITLE] captured in a single frame. No specific characters or activity. Pure atmosphere and light. [WORLD_RULES].',
    negativeAdditions: ['specific faces', 'text', 'watermark', 'irrelevant activities'],
    requiredContext: [],
  },

  atmosphere_environment: {
    key: 'atmosphere_environment',
    template: 'Environmental atmosphere plate for [PROJECT_TITLE]. [TONE_CONTEXT]. [WORLD_RULES]. Landscape composition, cinematic grading, natural light or motivated practical light. No characters. Film still quality.',
    negativeAdditions: ['people', 'text', 'modern objects unless period-appropriate'],
    requiredContext: [],
  },

  // Key Moment templates
  moment_tableau: {
    key: 'moment_tableau',
    template: 'Cinematic tableau capturing a dramatic moment: [MOMENT_DESCRIPTION]. [TONE_CONTEXT]. [PERIOD_CONTEXT]. Composed like a master shot — every element in the frame has purpose. Film still quality, anamorphic feel.',
    negativeAdditions: ['text', 'watermark', 'cartoon', 'anime'],
    requiredContext: ['momentDescription'],
  },

  moment_dramatic: {
    key: 'moment_dramatic',
    template: 'Dramatic scene moment: [MOMENT_DESCRIPTION]. [TONE_CONTEXT]. Emotionally charged composition, cinematic lighting that reinforces the narrative stakes. Film still quality.',
    negativeAdditions: ['text', 'watermark'],
    requiredContext: ['momentDescription'],
  },

  // Texture / Visual Language templates
  texture_detail: {
    key: 'texture_detail',
    template: 'Production design texture study for [PROJECT_TITLE]. [PERIOD_CONTEXT]. Close-up of material, surface, or environmental detail that defines the visual world. Tactile, sensory, cinematic macro photography feel. [WORLD_RULES].',
    negativeAdditions: ['people', 'faces', 'text'],
    requiredContext: [],
  },

  texture_composition: {
    key: 'texture_composition',
    template: 'Compositional reference frame for [PROJECT_TITLE]. [TONE_CONTEXT]. Demonstrates the visual grammar — lines, shapes, negative space, light/shadow interplay. No specific narrative content. Abstract but grounded in the world.',
    negativeAdditions: ['text', 'watermark', 'specific characters'],
    requiredContext: [],
  },

  // Poster / Cover templates
  poster_hero: {
    key: 'poster_hero',
    template: 'Cinematic key art composition for [PROJECT_TITLE]. [TONE_CONTEXT]. [GENRE_CONTEXT]. Iconic, poster-worthy composition that captures the essence of the project. High contrast, dramatic lighting, film poster quality.',
    negativeAdditions: ['text', 'title text', 'credits', 'watermark'],
    requiredContext: [],
  },

  // Generic fallback
  generic_cinematic: {
    key: 'generic_cinematic',
    template: 'Cinematic film still for [PROJECT_TITLE]. [TONE_CONTEXT]. [PERIOD_CONTEXT]. [WORLD_RULES]. High production value, naturalistic, emotionally grounded. Film still quality.',
    negativeAdditions: ['text', 'watermark', 'AI-generated look', 'plastic', 'cartoon'],
    requiredContext: [],
  },
};

// ── Slot-to-Template Mapping ─────────────────────────────────────────────────

type SubjectType = 'character' | 'world' | 'atmosphere' | 'moment' | 'texture' | 'poster' | 'generic';

const SLOT_TEMPLATE_MAP: Record<string, Record<string, string>> = {
  character: {
    close_up: 'character_close_up',
    medium: 'character_medium',
    full_body: 'character_full_body',
    profile: 'character_close_up',
    emotional_variant: 'character_medium',
    _default: 'character_close_up',
  },
  world: {
    wide: 'world_wide_establishing',
    atmospheric: 'world_atmospheric',
    detail: 'world_detail',
    establishing: 'world_wide_establishing',
    time_variant: 'world_atmospheric',
    _default: 'world_wide_establishing',
  },
  atmosphere: {
    atmospheric: 'atmosphere_lighting',
    lighting_ref: 'atmosphere_lighting',
    time_variant: 'atmosphere_environment',
    wide: 'atmosphere_environment',
    _default: 'atmosphere_lighting',
  },
  moment: {
    tableau: 'moment_tableau',
    wide: 'moment_tableau',
    medium: 'moment_dramatic',
    close_up: 'moment_dramatic',
    _default: 'moment_tableau',
  },
  texture: {
    texture_ref: 'texture_detail',
    detail: 'texture_detail',
    composition_ref: 'texture_composition',
    color_ref: 'texture_detail',
    _default: 'texture_detail',
  },
  poster: {
    _default: 'poster_hero',
  },
  generic: {
    _default: 'generic_cinematic',
  },
};

// ── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Resolve the best prompt template for a given slot requirement.
 */
export function resolvePromptTemplate(
  subjectType: SubjectType,
  shotType: string,
): PromptTemplate {
  const typeMap = SLOT_TEMPLATE_MAP[subjectType] || SLOT_TEMPLATE_MAP.generic;
  const templateKey = typeMap[shotType] || typeMap._default || 'generic_cinematic';
  return TEMPLATES[templateKey] || TEMPLATES.generic_cinematic;
}

/**
 * Build a complete prompt from a template and context.
 * Replaces all [PLACEHOLDER] tokens with actual values.
 */
export function buildPromptFromTemplate(
  template: PromptTemplate,
  context: PromptContext,
): { prompt: string; negativePrompt: string } {
  let prompt = template.template;

  // Replace placeholders
  const replacements: Record<string, string> = {
    '[PROJECT_TITLE]': context.projectTitle || 'the project',
    '[CHARACTER_NAME]': context.characterName || 'the character',
    '[CHARACTER_ROLE]': context.characterRole || '',
    '[CHARACTER_TRAITS]': context.characterTraits ? `Physical traits: ${context.characterTraits}.` : '',
    '[LOCATION]': context.locationName || 'the location',
    '[LOCATION_DESCRIPTION]': context.locationDescription || '',
    '[MOMENT_DESCRIPTION]': context.momentDescription || 'a pivotal story moment',
    '[COSTUME_NOTES]': context.costumeNotes ? `Costume: ${context.costumeNotes}.` : '',
    '[THEME]': context.theme || '',
    '[TONE_CONTEXT]': context.tone ? `Tone: ${context.tone}.` : '',
    '[GENRE_CONTEXT]': context.genre ? `Genre: ${context.genre}.` : '',
    '[PERIOD_CONTEXT]': context.period ? `Period: ${context.period}.` : '',
    '[WORLD_RULES]': context.worldRules ? `World: ${context.worldRules.slice(0, 150)}.` : '',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(placeholder, value);
  }

  // Clean up empty placeholders and double spaces
  prompt = prompt.replace(/\s{2,}/g, ' ').replace(/\.\s*\./g, '.').trim();

  const negativePrompt = [
    ...template.negativeAdditions,
    'low quality', 'blurry', 'deformed', 'amateur',
  ].join(', ');

  return { prompt, negativePrompt };
}
