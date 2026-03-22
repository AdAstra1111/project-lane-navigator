/**
 * compositionScoring — Deterministic composition quality scoring for lookbook selection.
 *
 * Evaluates whether a candidate image's metadata/provenance suggests good
 * compositional fit for the target slot. Uses only available deterministic signals.
 *
 * WEIGHTS (documented):
 *   framing_score:   40%  — does framing match slot intent?
 *   balance_score:   35%  — does compositional balance suit the slot?
 *   density_score:   25%  — is visual density appropriate?
 *   ---
 *   composition_total = weighted sum (0–100 scale)
 */
import type { ProjectImage } from '@/lib/images/types';
import { classifyOrientation } from '@/lib/images/orientationUtils';
import { resolveCompositionRuleForLookbookSlot, type CompositionRule } from './compositionRules';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CompositionScore {
  framing_score: number;
  balance_score: number;
  density_score: number;
  composition_total: number;
}

// ── Weight constants ─────────────────────────────────────────────────────────
const W_FRAMING = 0.40;
const W_BALANCE = 0.35;
const W_DENSITY = 0.25;

// ── Scoring Functions ────────────────────────────────────────────────────────

/**
 * Score framing fit (0–100).
 * Uses shot_type, orientation, and asset_group as deterministic proxies
 * for whether the image's framing matches the slot's composition rule.
 */
function scoreFraming(img: ProjectImage, rule: CompositionRule): number {
  let score = 50; // baseline
  const shotType = img.shot_type || '';
  const orientation = classifyOrientation(img.width, img.height);

  // Subject scale alignment
  if (rule.subject_scale === 'dominant') {
    // Dominant subject: close-ups and portraits score high
    if (['close_up', 'identity_headshot', 'emotional_variant', 'medium'].includes(shotType)) score += 25;
    else if (['full_body', 'profile'].includes(shotType)) score += 15;
    else if (['wide', 'atmospheric'].includes(shotType)) score -= 15;
    // Portrait orientation tends toward subject-dominant framing
    if (orientation === 'portrait') score += 5;
  } else if (rule.subject_scale === 'small_in_frame') {
    // Small in frame: wide/atmospheric shots score high
    if (['wide', 'atmospheric', 'time_variant'].includes(shotType)) score += 25;
    else if (['detail', 'composition_ref'].includes(shotType)) score += 10;
    else if (['close_up', 'identity_headshot'].includes(shotType)) score -= 20;
    // Landscape orientation tends toward environment framing
    if (orientation === 'landscape') score += 5;
  } else {
    // Balanced: medium shots, tableau score well
    if (['medium', 'tableau', 'over_shoulder'].includes(shotType)) score += 15;
    else if (['wide', 'close_up'].includes(shotType)) score += 5;
  }

  // Headroom proxy: portrait close-ups tend to have tighter headroom
  if (rule.headroom_bias === 'tight') {
    if (['close_up', 'identity_headshot', 'profile'].includes(shotType)) score += 5;
  } else if (rule.headroom_bias === 'airy') {
    if (['wide', 'atmospheric'].includes(shotType)) score += 5;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Score compositional balance fit (0–100).
 * Uses asset_group, shot_type, and orientation as proxies for
 * whether the image likely exhibits the desired balance pattern.
 */
function scoreBalance(img: ProjectImage, rule: CompositionRule): number {
  let score = 50;
  const shotType = img.shot_type || '';
  const assetGroup = img.asset_group || '';

  if (rule.balance === 'centered') {
    // Centered: portraits, headshots, poster compositions
    if (['identity_headshot', 'close_up', 'medium'].includes(shotType)) score += 20;
    if (['composition_ref', 'color_ref'].includes(shotType)) score += 10;
    if (assetGroup === 'character') score += 5;
  } else if (rule.balance === 'rule_of_thirds') {
    // Thirds: medium shots, tableau, dynamic compositions
    if (['medium', 'tableau', 'over_shoulder', 'emotional_variant'].includes(shotType)) score += 15;
    if (['close_up', 'profile'].includes(shotType)) score += 10;
    if (assetGroup === 'character' && shotType !== 'wide') score += 5;
  } else if (rule.balance === 'symmetrical') {
    // Symmetrical: formal, architectural
    if (['wide', 'atmospheric', 'composition_ref'].includes(shotType)) score += 15;
    if (['detail', 'texture_ref'].includes(shotType)) score += 5;
  } else if (rule.balance === 'environment_weighted') {
    // Environment-weighted: world-first imagery
    if (assetGroup === 'world') score += 20;
    if (['wide', 'atmospheric', 'time_variant'].includes(shotType)) score += 15;
    if (img.location_ref) score += 5;
    if (assetGroup === 'character' && ['close_up', 'medium'].includes(shotType)) score -= 15;
  }

  return Math.min(100, Math.max(0, score));
}

/**
 * Score visual density fit (0–100).
 * Uses shot_type and asset_group as proxies for information density.
 */
function scoreDensity(img: ProjectImage, rule: CompositionRule): number {
  let score = 50;
  const shotType = img.shot_type || '';
  const assetGroup = img.asset_group || '';

  if (rule.visual_density === 'minimal') {
    // Minimal: atmospheric, wide open, simple
    if (['atmospheric', 'wide'].includes(shotType)) score += 20;
    if (['time_variant'].includes(shotType)) score += 10;
    if (['detail', 'texture_ref'].includes(shotType)) score -= 10;
    if (['tableau'].includes(shotType)) score -= 5;
  } else if (rule.visual_density === 'dense') {
    // Dense: detail, texture, rich imagery
    if (['detail', 'texture_ref', 'composition_ref', 'lighting_ref'].includes(shotType)) score += 20;
    if (['tableau'].includes(shotType)) score += 10;
    if (assetGroup === 'world' && shotType === 'detail') score += 5;
    if (['atmospheric'].includes(shotType)) score -= 10;
  } else {
    // Balanced: most things work, slight preference for medium complexity
    if (['medium', 'close_up', 'full_body'].includes(shotType)) score += 10;
    if (['wide', 'tableau'].includes(shotType)) score += 5;
  }

  // Negative space proxy
  if (rule.negative_space_bias === 'high') {
    if (['wide', 'atmospheric'].includes(shotType)) score += 5;
    if (['detail', 'texture_ref'].includes(shotType)) score -= 5;
  } else if (rule.negative_space_bias === 'low') {
    if (['close_up', 'detail', 'texture_ref'].includes(shotType)) score += 5;
    if (['wide', 'atmospheric'].includes(shotType)) score -= 5;
  }

  return Math.min(100, Math.max(0, score));
}

// ── Main Scorer ──────────────────────────────────────────────────────────────

/**
 * Compute deterministic composition score for an image candidate.
 * Uses the resolved composition rule for the target slot.
 */
export function scoreComposition(
  img: ProjectImage,
  slideType: string,
): CompositionScore {
  const rule = resolveCompositionRuleForLookbookSlot(slideType);

  const framing_score = scoreFraming(img, rule);
  const balance_score = scoreBalance(img, rule);
  const density_score = scoreDensity(img, rule);

  const composition_total = Math.round(
    framing_score * W_FRAMING +
    balance_score * W_BALANCE +
    density_score * W_DENSITY
  );

  return { framing_score, balance_score, density_score, composition_total };
}
