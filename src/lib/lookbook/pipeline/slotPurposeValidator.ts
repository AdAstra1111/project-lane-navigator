/**
 * slotPurposeValidator — Hard rejection layer for candidate images.
 *
 * Validates whether a candidate image is editorially appropriate for a
 * given slide type, regardless of requirement-origin or score.
 *
 * This is the canonical slot-purpose gatekeeper. It runs BEFORE final
 * winner admission in requirementExecutor selection.
 *
 * Priority order for selection truth:
 * 1. Hard slot-purpose validity (this module)
 * 2. Identity correctness
 * 3. Requirement-origin / target_requirement_id
 * 4. Shot / orientation / provenance / other heuristics
 */
import type { ProjectImage } from '@/lib/images/types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SlotPurposeValidation {
  allowed: boolean;
  reasons: string[];
  /** Score adjustment (negative = penalty, applied even if allowed) */
  penalty: number;
}

// ── Slide families ───────────────────────────────────────────────────────────

/** Editorial slides — atmosphere/texture/mood, NOT narrative scenes */
const EDITORIAL_SLIDES = new Set([
  'creative_statement', 'visual_language', 'themes', 'world',
]);

/** Narrative slides — scenes with characters and story action */
const NARRATIVE_SLIDES = new Set([
  'key_moments', 'story_engine',
]);

// ── Detection helpers ────────────────────────────────────────────────────────

function isCharacterCentric(img: ProjectImage): boolean {
  const shotType = img.shot_type || '';
  const charShotTypes = ['close_up', 'medium', 'portrait', 'profile', 'three_quarter',
    'identity_headshot', 'identity_profile', 'identity_full_body', 'emotional_variant'];
  if (charShotTypes.includes(shotType)) return true;

  const assetGroup = (img as any).asset_group || '';
  if (assetGroup === 'character' || assetGroup === 'character_identity') return true;

  const gc = (img as any).generation_config as Record<string, unknown> | null;
  if (gc?.identity_mode) return true;

  return false;
}

function isEnvironmentDominant(img: ProjectImage): boolean {
  const shotType = img.shot_type || '';
  const envShots = ['wide', 'atmospheric', 'establishing', 'detail', 'time_variant'];
  if (envShots.includes(shotType)) return true;

  const assetGroup = (img as any).asset_group || '';
  if (assetGroup === 'world') return true;

  return false;
}

function isTextureOrComposition(img: ProjectImage): boolean {
  const shotType = img.shot_type || '';
  const texShots = ['texture_ref', 'lighting_ref', 'composition_ref', 'color_ref', 'detail'];
  if (texShots.includes(shotType)) return true;

  const assetGroup = (img as any).asset_group || '';
  if (assetGroup === 'visual_language') return true;

  return false;
}

function isNarrativeScene(img: ProjectImage): boolean {
  const shotType = img.shot_type || '';
  const sceneShots = ['tableau', 'over_shoulder'];
  if (sceneShots.includes(shotType)) return true;

  const assetGroup = (img as any).asset_group || '';
  if (assetGroup === 'key_moment') return true;

  if (img.moment_ref) return true;

  return false;
}

function isCraftOrTradeScene(img: ProjectImage): boolean {
  // Use generation prompt or metadata to detect pottery/craft/trade imagery
  const gc = (img as any).generation_config as Record<string, unknown> | null;
  const prompt = String(gc?.prompt || gc?.prompt_override || '').toLowerCase();
  const craftTerms = ['pottery', 'potter', 'kiln', 'crafting', 'weaving', 'forge',
    'blacksmith', 'workshop activity', 'making pottery', 'at the wheel'];
  return craftTerms.some(t => prompt.includes(t));
}

// ── Per-slide-type validators ────────────────────────────────────────────────

function validateCreativeStatement(img: ProjectImage): SlotPurposeValidation {
  const reasons: string[] = [];
  let penalty = 0;

  if (isCharacterCentric(img)) {
    // Hard reject character-centric images
    return { allowed: false, reasons: ['Character-centric image rejected for creative_statement (editorial/atmosphere slot)'], penalty: 0 };
  }
  if (isNarrativeScene(img) && !isEnvironmentDominant(img)) {
    return { allowed: false, reasons: ['Narrative scene rejected for creative_statement (requires atmospheric/editorial imagery)'], penalty: 0 };
  }
  if (isCraftOrTradeScene(img)) {
    return { allowed: false, reasons: ['Craft/trade scene rejected for creative_statement'], penalty: 0 };
  }
  // Mild penalty for non-ideal but not rejected images
  if (!isEnvironmentDominant(img) && !isTextureOrComposition(img)) {
    penalty = -5;
    reasons.push('Not strongly atmospheric — mild penalty');
  }

  return { allowed: true, reasons, penalty };
}

function validateWorld(img: ProjectImage): SlotPurposeValidation {
  if (isCharacterCentric(img)) {
    return { allowed: false, reasons: ['Character-centric image rejected for world slide (requires environment dominance)'], penalty: 0 };
  }
  if (isCraftOrTradeScene(img)) {
    return { allowed: false, reasons: ['Craft/trade activity scene rejected for world slide'], penalty: 0 };
  }
  const reasons: string[] = [];
  let penalty = 0;
  if (!isEnvironmentDominant(img)) {
    penalty = -8;
    reasons.push('Not strongly environment-dominant — penalty');
  }
  return { allowed: true, reasons, penalty };
}

function validateVisualLanguage(img: ProjectImage): SlotPurposeValidation {
  if (isCharacterCentric(img) && !isTextureOrComposition(img)) {
    return { allowed: false, reasons: ['Character-centric narrative image rejected for visual_language (requires texture/light/composition)'], penalty: 0 };
  }
  if (isNarrativeScene(img)) {
    return { allowed: false, reasons: ['Narrative scene rejected for visual_language slide'], penalty: 0 };
  }
  const reasons: string[] = [];
  let penalty = 0;
  if (!isTextureOrComposition(img) && !isEnvironmentDominant(img)) {
    penalty = -5;
    reasons.push('Not clearly texture/composition reference — mild penalty');
  }
  return { allowed: true, reasons, penalty };
}

function validateThemes(img: ProjectImage): SlotPurposeValidation {
  if (isCraftOrTradeScene(img)) {
    return { allowed: false, reasons: ['Repeated craft/trade scene rejected for themes slide'], penalty: 0 };
  }
  const reasons: string[] = [];
  let penalty = 0;
  if (isCharacterCentric(img) && !isEnvironmentDominant(img)) {
    penalty = -10;
    reasons.push('Character-centric image penalized for themes (prefer symbolic/atmospheric)');
  }
  if (isNarrativeScene(img) && !isEnvironmentDominant(img)) {
    penalty = -8;
    reasons.push('Literal narrative scene penalized for themes (prefer symbolic)');
  }
  return { allowed: true, reasons, penalty };
}

function validateKeyMoments(img: ProjectImage): SlotPurposeValidation {
  // Key moments = dramatic action scenes with characters
  const reasons: string[] = [];
  let penalty = 0;
  if (isTextureOrComposition(img) && !isNarrativeScene(img)) {
    penalty = -10;
    reasons.push('Pure texture reference penalized for key_moments (needs narrative action)');
  }
  if (isEnvironmentDominant(img) && !isCharacterCentric(img) && !isNarrativeScene(img)) {
    penalty = -8;
    reasons.push('Empty environment penalized for key_moments (needs character presence)');
  }
  // Penalize static/relational compositions — key_moments wants ACTION
  const gc = (img as any).generation_config as Record<string, unknown> | null;
  const prompt = String(gc?.prompt || gc?.prompt_override || '').toLowerCase();
  if (prompt.includes('power dynamic') || prompt.includes('relational tension') || prompt.includes('who controls')) {
    penalty -= 5;
    reasons.push('Relational/power-dynamic composition penalized for key_moments (prefers action scenes)');
  }
  return { allowed: true, reasons, penalty };
}

function validateStoryEngine(img: ProjectImage): SlotPurposeValidation {
  // Story engine = relational tension, power dynamics, interpersonal stakes
  const reasons: string[] = [];
  let penalty = 0;
  if (isTextureOrComposition(img) && !isNarrativeScene(img)) {
    penalty = -10;
    reasons.push('Pure texture reference penalized for story_engine');
  }
  if (isEnvironmentDominant(img) && !isCharacterCentric(img)) {
    penalty = -8;
    reasons.push('Empty environment penalized for story_engine (needs character presence)');
  }
  // Penalize pure action — story_engine wants relational tension not fight choreography
  const gc = (img as any).generation_config as Record<string, unknown> | null;
  const prompt = String(gc?.prompt || gc?.prompt_override || '').toLowerCase();
  if (prompt.includes('confrontation') || prompt.includes('chase') || prompt.includes('fight')) {
    penalty -= 3;
    reasons.push('Action/confrontation mildly penalized for story_engine (prefers relational tension)');
  }
  return { allowed: true, reasons, penalty };
}

function validateCharacters(img: ProjectImage): SlotPurposeValidation {
  if (isEnvironmentDominant(img) && !isCharacterCentric(img)) {
    return { allowed: false, reasons: ['Environment-only image rejected for characters slide'], penalty: 0 };
  }
  return { allowed: true, reasons: [], penalty: 0 };
}

// ── Registry ─────────────────────────────────────────────────────────────────

const VALIDATORS: Record<string, (img: ProjectImage) => SlotPurposeValidation> = {
  creative_statement: validateCreativeStatement,
  world: validateWorld,
  visual_language: validateVisualLanguage,
  themes: validateThemes,
  key_moments: validateKeyMoments,
  story_engine: validateStoryEngine,
  characters: validateCharacters,
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate whether a candidate image is editorially appropriate for a slide type.
 * Returns allowed=false for hard rejections, or penalty adjustments for soft issues.
 */
export function validateCandidateForSlidePurpose(
  img: ProjectImage,
  slideType: string,
): SlotPurposeValidation {
  const validator = VALIDATORS[slideType];
  if (!validator) {
    // No validator = no restriction (cover, poster_directions, closing, comparables)
    return { allowed: true, reasons: [], penalty: 0 };
  }
  return validator(img);
}

/**
 * Check if a slide type is editorial (atmosphere/texture/mood, not narrative).
 */
export function isEditorialSlide(slideType: string): boolean {
  return EDITORIAL_SLIDES.has(slideType);
}

/**
 * Check if a slide type is narrative (scenes with characters/action).
 */
export function isNarrativeSlide(slideType: string): boolean {
  return NARRATIVE_SLIDES.has(slideType);
}
