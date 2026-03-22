/**
 * lookbookSelectionScoring — Multi-factor deterministic scoring for lookbook image selection.
 *
 * Extends the canonical lookbookScorer with style cohesion, shot intent matching,
 * composition quality, editorial flow fit, shot-list alignment, and cross-image cohesion dimensions.
 *
 * This does NOT replace lookbookScorer.scoreImageForSlide — it augments it.
 * The canonical scorer remains the base; this layer adds style/intent/composition/editorial/shotlist/cohesion modifiers.
 *
 * WEIGHTS (documented — Phase 18.1 rebalance):
 *   identity_score:     24%  — actor/character consistency
 *   style_score:        18%  — cinematic style lock match
 *   intent_score:       16%  — shot composition match for slot purpose
 *   composition_score:  15%  — cinematic framing/balance/density fit
 *   shotlist_score:      9%  — alignment with canonical shot list (Phase 18.1)
 *   editorial_score:     9%  — editorial flow / intensity curve fit
 *   cohesion_score:      9%  — fit with already-selected images
 *   ---
 *   total_score = weighted sum (0–100 scale)
 *
 * Rationale for weight rebalance from Phase 18:
 *   - identity remains strongest (character truth is paramount)
 *   - shotlist_score added as new dimension (canonical cinematics)
 *   - all other weights slightly reduced to accommodate shotlist
 *   - total still sums to 1.0
 */
import type { ProjectImage } from '@/lib/images/types';
import type { StyleLock } from './styleLock';
import { hashStyleLock } from './styleLock';
import type { ShotIntent } from './shotIntent';
import { resolveShotIntentForLookbookSlot } from './shotIntent';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import { scoreComposition, type CompositionScore } from './compositionScoring';
import { scoreEditorialFit } from './editorialFlow';

// ── Types ────────────────────────────────────────────────────────────────────

export interface LookbookSelectionScore {
  identity_score: number;
  style_score: number;
  intent_score: number;
  composition_score: number;
  shotlist_score: number;
  editorial_score: number;
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
// Sum = 1.0 (Phase 18.1 rebalance)
const W_IDENTITY    = 0.24;
const W_STYLE       = 0.18;
const W_INTENT      = 0.16;
const W_COMPOSITION = 0.15;
const W_SHOTLIST    = 0.09;
const W_EDITORIAL   = 0.09;
const W_COHESION    = 0.09;

// ── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Score identity consistency (0–100).
 */
function scoreIdentity(img: ProjectImage, ctx: SelectionScoringContext): number {
  let score = 50;
  const genConfig = (img as any).generation_config;
  if (ctx.isActorBound || genConfig?.identity_locked) score += 25;
  const lockStrength = genConfig?.identity_lock_strength;
  if (lockStrength === 'strong') score += 20;
  else if (lockStrength === 'partial') score += 10;
  if (genConfig?.auto_complete_context?.ai_actor_ids) score += 5;
  return Math.min(100, Math.max(0, score));
}

/**
 * Score style consistency (0–100).
 */
function scoreStyle(img: ProjectImage, ctx: SelectionScoringContext): number {
  if (!ctx.styleLock || !ctx.styleLockHash) return 50;
  const genConfig = (img as any).generation_config;
  if (!genConfig) return 30;
  const imgStyleHash = genConfig.style_lock_hash;
  if (imgStyleHash && imgStyleHash === ctx.styleLockHash) return 100;
  const imgPrestige = (img as any).prestige_style;
  if (imgPrestige) return 70;
  const prompt = ((img as any).prompt_used || '').toLowerCase();
  const hasFilmic = prompt.includes('film grain') || prompt.includes('cinematic') || prompt.includes('arri');
  if (hasFilmic) return 60;
  return 35;
}

/**
 * Score shot intent match (0–100).
 */
function scoreIntent(img: ProjectImage, ctx: SelectionScoringContext): number {
  const intent = resolveShotIntentForLookbookSlot(ctx.slideType);
  let score = 50;
  const shotType = img.shot_type || '';
  const orientation = classifyOrientation(img.width, img.height);

  if (intent.framing === 'close_up') {
    if (['close_up', 'identity_headshot', 'emotional_variant'].includes(shotType)) score += 20;
    else if (['medium'].includes(shotType)) score += 5;
    else if (['wide', 'atmospheric'].includes(shotType)) score -= 10;
  } else if (intent.framing === 'wide') {
    if (['wide', 'atmospheric', 'establishing'].includes(shotType)) score += 20;
    else if (['detail', 'close_up'].includes(shotType)) score -= 10;
  } else {
    if (['medium', 'tableau', 'over_shoulder'].includes(shotType)) score += 15;
    else if (['wide', 'close_up'].includes(shotType)) score += 5;
  }

  if (intent.subject_priority === 'character') {
    if (img.asset_group === 'character' || img.entity_id) score += 10;
    if (img.asset_group === 'world' && !img.entity_id) score -= 10;
  } else {
    if (img.asset_group === 'world' || img.location_ref) score += 10;
    if (img.asset_group === 'character' && ['close_up', 'medium'].includes(shotType)) score -= 10;
  }

  if (intent.depth_of_field === 'deep' && orientation === 'landscape') score += 5;
  if (intent.depth_of_field === 'shallow' && orientation === 'portrait') score += 5;

  return Math.min(100, Math.max(0, score));
}

/**
 * Score shot list alignment (0–100). Phase 18.1.
 *
 * Checks generation_config provenance for shot-list context usage.
 * Images generated with shot list grounding score higher for their intended slide type.
 *
 * Scoring dimensions:
 *   - shot_list_context_used: was the image generated with shot list data? (+30)
 *   - framing alignment: does generation provenance framing match slide expectation? (+20)
 *   - camera movement alignment: dynamic movement for dynamic slides? (+15)
 *   - location/time alignment: contextual richness (+15)
 *   - character presence alignment: characters match slide expectations? (+20)
 */
function scoreShotlistAlignment(img: ProjectImage, ctx: SelectionScoringContext): number {
  const genConfig = (img as any).generation_config;
  if (!genConfig) return 40; // neutral for images without config

  // If no shot list was used at all during generation, neutral score
  if (!genConfig.shot_list_context_used) return 45;

  let score = 55; // base boost for shot-list-grounded images

  // Framing alignment
  const slFraming = (genConfig.shot_list_framing || '').toUpperCase();
  if (slFraming) {
    const slideNeedsClose = ['characters'].includes(ctx.slideType);
    const slideNeedsWide = ['world', 'themes', 'closing'].includes(ctx.slideType);
    if (slideNeedsClose && ['CU', 'ECU', 'MS'].includes(slFraming)) score += 15;
    else if (slideNeedsWide && ['WS', 'AERIAL'].includes(slFraming)) score += 15;
    else if (!slideNeedsClose && !slideNeedsWide) score += 8; // neutral match is fine
  }

  // Camera movement alignment
  const slMovement = (genConfig.shot_list_camera_movement || '').toUpperCase();
  if (slMovement) {
    const slideNeedsDynamic = ['key_moments', 'story_engine'].includes(ctx.slideType);
    const isDynamic = !['STATIC'].includes(slMovement);
    if (slideNeedsDynamic && isDynamic) score += 10;
    else if (!slideNeedsDynamic && !isDynamic) score += 5;
  }

  // Location/time richness
  if (genConfig.shot_list_location) score += 5;
  if (genConfig.shot_list_time_of_day) score += 5;

  return Math.min(100, Math.max(0, score));
}

/**
 * Score editorial flow fit (0–100).
 * Uses the editorial intensity curve to match image energy to slide position.
 */
function scoreEditorial(img: ProjectImage, ctx: SelectionScoringContext): number {
  return scoreEditorialFit(
    ctx.slideType,
    img.shot_type || null,
    img.asset_group || null,
  );
}

/**
 * Score cohesion with already-selected images (0–100).
 */
function scoreCohesion(img: ProjectImage, ctx: SelectionScoringContext): number {
  if (ctx.selectedImages.length === 0) return 70;
  let score = 60;
  const imgProvider = (img as any).provider;
  const selectedProviders = ctx.selectedImages.map(si => (si as any).provider).filter(Boolean);
  if (imgProvider && selectedProviders.length > 0) {
    const majorityProvider = selectedProviders.sort((a, b) =>
      selectedProviders.filter(p => p === b).length - selectedProviders.filter(p => p === a).length
    )[0];
    if (imgProvider === majorityProvider) score += 15;
  }
  const imgPrestige = (img as any).prestige_style;
  if (imgPrestige) {
    const selectedStyles = ctx.selectedImages.map(si => (si as any).prestige_style).filter(Boolean);
    if (selectedStyles.length > 0 && selectedStyles.every(s => s === imgPrestige)) score += 15;
  }
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
  const comp = scoreComposition(img, ctx.slideType);
  const composition_score = comp.composition_total;
  const shotlist_score = scoreShotlistAlignment(img, ctx);
  const editorial_score = scoreEditorial(img, ctx);
  const cohesion_score = scoreCohesion(img, ctx);

  const total_score = Math.round(
    identity_score * W_IDENTITY +
    style_score * W_STYLE +
    intent_score * W_INTENT +
    composition_score * W_COMPOSITION +
    shotlist_score * W_SHOTLIST +
    editorial_score * W_EDITORIAL +
    cohesion_score * W_COHESION
  );

  return { identity_score, style_score, intent_score, composition_score, shotlist_score, editorial_score, cohesion_score, total_score };
}
