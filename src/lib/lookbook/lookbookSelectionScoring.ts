/**
 * lookbookSelectionScoring — Multi-factor deterministic scoring for lookbook image selection.
 *
 * Extends the canonical lookbookScorer with style cohesion, shot intent matching,
 * and cross-image cohesion dimensions.
 *
 * This does NOT replace lookbookScorer.scoreImageForSlide — it augments it.
 * The canonical scorer remains the base; this layer adds style/intent/cohesion modifiers.
 *
 * WEIGHTS (documented):
 *   identity_score:  30%  — actor/character consistency
 *   style_score:     25%  — cinematic style lock match
 *   intent_score:    25%  — shot composition match for slot purpose
 *   cohesion_score:  20%  — fit with already-selected images
 *   ---
 *   total_score = weighted sum (0–100 scale)
 */
import type { ProjectImage } from '@/lib/images/types';
import type { StyleLock } from './styleLock';
import { hashStyleLock } from './styleLock';
import type { ShotIntent } from './shotIntent';
import { resolveShotIntentForLookbookSlot } from './shotIntent';
import { classifyOrientation } from '@/lib/images/orientationUtils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LookbookSelectionScore {
  identity_score: number;
  style_score: number;
  intent_score: number;
  cohesion_score: number;
  total_score: number;
}

export interface SelectionScoringContext {
  /** Current project style lock */
  styleLock: StyleLock | null;
  /** Style lock hash for comparison */
  styleLockHash: string | null;
  /** Slide/section type being scored */
  slideType: string;
  /** Images already selected for this deck build */
  selectedImages: ProjectImage[];
  /** Whether this image has actor-bound identity */
  isActorBound?: boolean;
  /** Whether identity lock was used during generation */
  identityLocked?: boolean;
}

// ── Weight constants ─────────────────────────────────────────────────────────
// Sum = 1.0
const W_IDENTITY = 0.30;
const W_STYLE    = 0.25;
const W_INTENT   = 0.25;
const W_COHESION = 0.20;

// ── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Score identity consistency (0–100).
 * Higher if actor-bound, identity-locked, and consistent metadata.
 */
function scoreIdentity(img: ProjectImage, ctx: SelectionScoringContext): number {
  let score = 50; // Baseline for unknown

  const genConfig = (img as any).generation_config;

  // Actor-bound identity
  if (ctx.isActorBound || genConfig?.identity_locked) {
    score += 25;
  }

  // Identity lock strength
  const lockStrength = genConfig?.identity_lock_strength;
  if (lockStrength === 'strong') score += 20;
  else if (lockStrength === 'partial') score += 10;

  // Actor ID present
  if (genConfig?.auto_complete_context?.ai_actor_ids) score += 5;

  return Math.min(100, Math.max(0, score));
}

/**
 * Score style consistency (0–100).
 * Checks if image was generated under the same style lock.
 */
function scoreStyle(img: ProjectImage, ctx: SelectionScoringContext): number {
  if (!ctx.styleLock || !ctx.styleLockHash) return 50; // No lock = neutral

  const genConfig = (img as any).generation_config;
  if (!genConfig) return 30; // No provenance = lower

  // Check if image has style_lock_hash in provenance
  const imgStyleHash = genConfig.style_lock_hash;
  if (imgStyleHash && imgStyleHash === ctx.styleLockHash) {
    return 100; // Exact match
  }

  // Check prestige style match as proxy
  const imgPrestige = (img as any).prestige_style;
  if (imgPrestige) {
    return 70; // Has style system but may differ
  }

  // Check photorealistic directive presence
  const prompt = ((img as any).prompt_used || '').toLowerCase();
  const hasFilmic = prompt.includes('film grain') || prompt.includes('cinematic') || prompt.includes('arri');
  if (hasFilmic) return 60;

  return 35; // Likely inconsistent
}

/**
 * Score shot intent match (0–100).
 * Checks if image composition aligns with slot's expected shot intent.
 */
function scoreIntent(img: ProjectImage, ctx: SelectionScoringContext): number {
  const intent = resolveShotIntentForLookbookSlot(ctx.slideType);
  let score = 50;

  const shotType = img.shot_type || '';
  const orientation = classifyOrientation(img.width, img.height);

  // Framing match
  if (intent.framing === 'close_up') {
    if (['close_up', 'identity_headshot', 'emotional_variant'].includes(shotType)) score += 20;
    else if (['medium'].includes(shotType)) score += 5;
    else if (['wide', 'atmospheric'].includes(shotType)) score -= 10;
  } else if (intent.framing === 'wide') {
    if (['wide', 'atmospheric', 'establishing'].includes(shotType)) score += 20;
    else if (['detail', 'close_up'].includes(shotType)) score -= 10;
  } else { // medium
    if (['medium', 'tableau', 'over_shoulder'].includes(shotType)) score += 15;
    else if (['wide', 'close_up'].includes(shotType)) score += 5;
  }

  // Subject priority match
  if (intent.subject_priority === 'character') {
    if (img.asset_group === 'character' || img.entity_id) score += 10;
    if (img.asset_group === 'world' && !img.entity_id) score -= 10;
  } else { // environment
    if (img.asset_group === 'world' || img.location_ref) score += 10;
    if (img.asset_group === 'character' && ['close_up', 'medium'].includes(shotType)) score -= 10;
  }

  // Depth of field heuristic — landscape = deep, portrait = shallow tendency
  if (intent.depth_of_field === 'deep' && orientation === 'landscape') score += 5;
  if (intent.depth_of_field === 'shallow' && orientation === 'portrait') score += 5;

  return Math.min(100, Math.max(0, score));
}

/**
 * Score cohesion with already-selected images (0–100).
 * Ensures the new image fits the visual family of what's already chosen.
 */
function scoreCohesion(img: ProjectImage, ctx: SelectionScoringContext): number {
  if (ctx.selectedImages.length === 0) return 70; // No comparison baseline

  let score = 60;

  const genConfig = (img as any).generation_config;
  const imgProvider = (img as any).provider;
  const imgModel = (img as any).model;

  // Same model/provider as majority of selected = cohesion bonus
  const selectedProviders = ctx.selectedImages.map(si => (si as any).provider).filter(Boolean);
  if (imgProvider && selectedProviders.length > 0) {
    const majorityProvider = selectedProviders.sort((a, b) =>
      selectedProviders.filter(p => p === b).length - selectedProviders.filter(p => p === a).length
    )[0];
    if (imgProvider === majorityProvider) score += 15;
  }

  // Same prestige style as already selected
  const imgPrestige = (img as any).prestige_style;
  if (imgPrestige) {
    const selectedStyles = ctx.selectedImages.map(si => (si as any).prestige_style).filter(Boolean);
    if (selectedStyles.length > 0 && selectedStyles.every(s => s === imgPrestige)) {
      score += 15;
    }
  }

  // Temporal proximity — images generated close together tend to share style
  const imgTime = new Date(img.created_at || 0).getTime();
  const selectedTimes = ctx.selectedImages.map(si => new Date(si.created_at || 0).getTime());
  if (selectedTimes.length > 0) {
    const avgTime = selectedTimes.reduce((a, b) => a + b, 0) / selectedTimes.length;
    const timeDiffHours = Math.abs(imgTime - avgTime) / (1000 * 60 * 60);
    if (timeDiffHours < 1) score += 10;
    else if (timeDiffHours < 24) score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

// ── Main Scorer ──────────────────────────────────────────────────────────────

/**
 * Compute multi-factor lookbook selection score for an image.
 * Returns a breakdown and weighted total (0–100).
 */
export function scoreLookbookCandidate(
  img: ProjectImage,
  ctx: SelectionScoringContext,
): LookbookSelectionScore {
  const identity_score = scoreIdentity(img, ctx);
  const style_score = scoreStyle(img, ctx);
  const intent_score = scoreIntent(img, ctx);
  const cohesion_score = scoreCohesion(img, ctx);

  const total_score = Math.round(
    identity_score * W_IDENTITY +
    style_score * W_STYLE +
    intent_score * W_INTENT +
    cohesion_score * W_COHESION
  );

  return { identity_score, style_score, intent_score, cohesion_score, total_score };
}
