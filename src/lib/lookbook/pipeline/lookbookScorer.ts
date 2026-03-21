/**
 * lookbookScorer — Canonical image scoring system for LookBook.
 * 
 * SINGLE SOURCE OF TRUTH for all image scoring.
 * No other module may implement alternative scoring logic.
 * 
 * Pure function — no hidden closures. All context passed explicitly.
 */
import type { ProjectImage } from '@/lib/images/types';
import { classifyOrientation } from '@/lib/images/orientationUtils';

// ── Scoring Context ──────────────────────────────────────────────────────────

export interface ScoringContext {
  /** Deck-level URL usage for reuse penalty */
  deckImageUsage: Map<string, { count: number; usedOnSlides: string[] }>;
  /** Semantic fingerprint usage for diversity penalty */
  usedFingerprints: Map<string, number>;
}

// ── Fingerprint ──────────────────────────────────────────────────────────────

export function getImageFingerprint(img: ProjectImage): string {
  return [
    img.asset_group || 'none',
    img.subject || 'none',
    img.location_ref || 'none',
    img.shot_type || 'none',
  ].join('|');
}

// ── Anti-Pattern Detection ───────────────────────────────────────────────────

/** Detect craft/workshop/occupation imagery */
export function isCraftScene(img: ProjectImage): boolean {
  const text = [
    (img as any).prompt_used || '',
    (img as any).description || '',
    img.subject_ref || '',
    img.location_ref || '',
  ].join(' ').toLowerCase();
  return (
    text.includes('pottery') ||
    text.includes('ceramic') ||
    text.includes('workshop') ||
    text.includes('kiln') ||
    text.includes('craftsman') ||
    text.includes('artisan') ||
    text.includes('handicraft') ||
    text.includes('pottery wheel') ||
    text.includes('forging') ||
    text.includes('blacksmith') ||
    text.includes('weaving') ||
    text.includes('loom') ||
    text.includes('sculpting') ||
    text.includes('performing their trade') ||
    text.includes('craft process')
  );
}

/** Detect character-centered composition in environment context */
export function isCharacterCenteredInEnvironment(img: ProjectImage): boolean {
  const text = ((img as any).prompt_used || '').toLowerCase();
  if (img.asset_group === 'world' || (img as any).subject_type === 'location' || (img as any).subject_type === 'world') {
    return (
      (img.shot_type === 'close_up' || img.shot_type === 'medium') &&
      !!(img.subject_ref) &&
      text.includes('character')
    );
  }
  return false;
}

// ── Canonical Scorer ─────────────────────────────────────────────────────────

/**
 * Score an image for a specific slide type.
 * 
 * This is the ONLY scoring function. All image selection must use this.
 * 
 * @param img - The image to score
 * @param slideType - The target slide type
 * @param applyReusePenalty - Whether to apply deck-level reuse and fingerprint penalties
 * @param context - Explicit scoring context (usage trackers)
 */
export function scoreImageForSlide(
  img: ProjectImage,
  slideType: string,
  applyReusePenalty: boolean = true,
  context?: ScoringContext,
): number {
  let score = 0;
  const hasNarrative = !!(img.entity_id || img.location_ref || img.moment_ref || img.subject_ref);
  const isLandscape = classifyOrientation(img.width, img.height) === 'landscape';

  // Narrative truth bonus (highest priority)
  if (hasNarrative) score += 25;

  // Primary bonus — REDUCED so newer approved images can compete
  if (img.is_primary) score += 3;

  // Landscape bonus for background slots
  if (isLandscape) score += 8;

  // Freshness boost
  const ageMs = Date.now() - new Date(img.created_at || 0).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < 1) score += 12;
  else if (ageDays < 3) score += 8;
  else if (ageDays < 7) score += 4;

  // ── Cinematic Fidelity Scoring ──
  const promptText = ((img as any).prompt_used || (img as any).description || '').toLowerCase();
  const isPhotorealPrompt = promptText.includes('photorealistic') || promptText.includes('film still') || promptText.includes('cinematic') || promptText.includes('arri');
  const isNonPhotoreal = promptText.includes('illustration') || promptText.includes('painting') || promptText.includes('anime') || promptText.includes('concept art') || promptText.includes('watercolor') || promptText.includes('sketch') || promptText.includes('cartoon');

  if (isPhotorealPrompt) score += 6;
  if (isNonPhotoreal) score -= 15;

  // Resolution quality proxy
  const megapixels = ((img.width || 0) * (img.height || 0)) / 1_000_000;
  if (megapixels >= 2) score += 4;
  else if (megapixels >= 1) score += 2;
  else if (megapixels > 0 && megapixels < 0.3) score -= 5;

  // Higher fidelity threshold for hero/poster slots
  if ((slideType === 'cover' || slideType === 'closing') && isNonPhotoreal) {
    score -= 10;
  }

  // Section-specific scoring
  const shotType = img.shot_type || '';
  switch (slideType) {
    case 'world':
      if (['wide', 'atmospheric', 'establishing'].includes(shotType)) score += 15;
      if (img.asset_group === 'world') score += 12;
      if (img.location_ref) score += 10;
      if (['texture_ref', 'detail', 'composition_ref', 'color_ref'].includes(shotType)) score -= 15;
      if (img.asset_group === 'visual_language' && !img.location_ref) score -= 10;
      break;
    case 'themes':
      if (['atmospheric', 'time_variant', 'lighting_ref'].includes(shotType)) score += 15;
      if (img.asset_group === 'visual_language') score += 8;
      if (['texture_ref', 'detail'].includes(shotType) && !img.location_ref) score -= 8;
      break;
    case 'visual_language':
      if (['texture_ref', 'detail', 'composition_ref', 'color_ref', 'lighting_ref'].includes(shotType)) score += 15;
      break;
    case 'key_moments':
      if (['tableau', 'medium', 'close_up', 'wide'].includes(shotType)) score += 15;
      if (img.asset_group === 'key_moment') score += 12;
      if (img.moment_ref) score += 10;
      if (['texture_ref', 'detail', 'composition_ref', 'color_ref'].includes(shotType)) score -= 15;
      break;
    case 'story_engine':
      if (img.moment_ref) score += 12;
      if (img.asset_group === 'key_moment') score += 8;
      if (['texture_ref', 'detail'].includes(shotType)) score -= 10;
      break;
    case 'cover':
      if (img.role === 'poster_primary') score += 20;
      if (img.role === 'poster_variant') score += 10;
      if (['texture_ref', 'detail', 'composition_ref'].includes(shotType)) score -= 20;
      break;
    case 'closing':
      if (img.role === 'poster_primary') score += 20;
      if (img.role === 'poster_variant') score += 10;
      if (['texture_ref', 'detail'].includes(shotType)) score -= 15;
      break;
    case 'creative_statement':
      if (['atmospheric', 'wide'].includes(shotType)) score += 10;
      if (['texture_ref', 'detail'].includes(shotType)) score -= 12;
      break;
  }

  // Deck-level reuse penalty
  if (applyReusePenalty && context && img.signedUrl) {
    const usage = context.deckImageUsage.get(img.signedUrl);
    if (usage && usage.count > 0) {
      score += usage.count * -30;
    }
  }

  // Semantic fingerprint diversity penalty
  if (applyReusePenalty && context) {
    const fp = getImageFingerprint(img);
    const fpCount = context.usedFingerprints.get(fp) || 0;
    score += fpCount * -25;
  }

  // Anti-pattern: craft/workshop imagery penalty on non-visual-language slides
  if (slideType !== 'visual_language' && isCraftScene(img)) {
    score -= 25;
    if (slideType === 'world' || slideType === 'creative_statement') {
      score -= 20;
    }
  }

  // Anti-pattern: character-centered composition in world/environment slot
  if ((slideType === 'world' || slideType === 'creative_statement' || slideType === 'themes') && isCharacterCenteredInEnvironment(img)) {
    score -= 15;
  }

  return score;
}
