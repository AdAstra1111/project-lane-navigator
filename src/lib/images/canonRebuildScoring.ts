/**
 * Canon Rebuild Scoring Engine — General-purpose slot scorer for Full Canon Rebuild.
 *
 * Unlike identityAlignmentScoring.ts (which targets identity slots only),
 * this scorer works for ALL visual set slot types:
 *   - character identity (headshot, profile, full_body)
 *   - character reference (close_up, medium, full_body, profile, emotional_variant)
 *   - world (wide, atmospheric, detail, time_variant)
 *   - visual language (lighting_ref, texture_ref, composition_ref, color_ref)
 *   - key moments (tableau, medium, close_up, wide)
 *   - poster (poster_theatrical, poster_alt)
 *
 * Scoring components:
 *   1. slot_match       — does shot_type match target? (0.30)
 *   2. aspect_fit       — correct aspect ratio for slot? (0.15)
 *   3. portrait_suit    — portrait suitability for vertical drama (0.20 when VD, else 0.00)
 *   4. curation_quality — governance verdict from image_evaluations (0.10)
 *   5. binding_fidelity — entity binding precision (exact > derived > heuristic) (0.15)
 *   6. freshness        — newer images preferred in rebuild context (0.10)
 *
 * Returns deterministic ranking per slot with exactly one winner.
 */

import type { ProjectImage } from './types';
import { SHOT_ASPECT_RATIO, PORTRAIT_SHOT_OVERRIDE, type AspectRatio } from './requiredVisualSet';

// ── Types ──

export interface SlotTarget {
  key: string;                // unique slot identifier
  assetGroup: string;         // character, world, visual_language, key_moment, poster
  subject: string | null;     // character name, location name, or null
  shotType: string;           // identity_headshot, wide, etc.
  expectedAspectRatio: AspectRatio;
  isIdentity: boolean;
}

export interface ScoredSlotCandidate {
  imageId: string;
  slotKey: string;
  totalScore: number;
  components: {
    slotMatch: number;
    aspectFit: number;
    portraitSuitability: number;
    curationQuality: number;
    bindingFidelity: number;
    freshness: number;
  };
  isPortraitSafe: boolean;
  eligible: boolean;
  reasons: string[];
}

export interface SlotWinnerResult {
  slotKey: string;
  winner: ScoredSlotCandidate | null;
  allScored: ScoredSlotCandidate[];
  noWinnerReason: string | null;
}

// ── Weights ──

const WEIGHTS_STANDARD = {
  slotMatch: 0.35,
  aspectFit: 0.15,
  portraitSuitability: 0.00, // disabled for non-VD
  curationQuality: 0.15,
  bindingFidelity: 0.20,
  freshness: 0.15,
};

const WEIGHTS_VERTICAL_DRAMA = {
  slotMatch: 0.25,
  aspectFit: 0.10,
  portraitSuitability: 0.25, // heavily weighted for VD
  curationQuality: 0.10,
  bindingFidelity: 0.15,
  freshness: 0.15,
};

// ── Scoring Functions ──

function scoreSlotMatch(imageShotType: string | null, targetShotType: string): { score: number; eligible: boolean; reason: string } {
  const st = (imageShotType || '').toLowerCase();
  const target = targetShotType.toLowerCase();

  if (st === target) {
    return { score: 100, eligible: true, reason: `Exact slot match: ${target}` };
  }

  // Related shot partial credit
  const RELATED: Record<string, Record<string, number>> = {
    wide: { atmospheric: 40, composition_ref: 30, tableau: 50 },
    atmospheric: { wide: 40, lighting_ref: 50, time_variant: 30 },
    close_up: { identity_headshot: 50, medium: 30, emotional_variant: 40 },
    medium: { close_up: 30, full_body: 20, over_shoulder: 25 },
    tableau: { wide: 40, medium: 20 },
    identity_headshot: { close_up: 60, medium: 20, profile: 15 },
    identity_profile: { profile: 70, medium: 20, close_up: 10 },
    identity_full_body: { full_body: 80, medium: 15 },
    lighting_ref: { atmospheric: 50, composition_ref: 30 },
    texture_ref: { detail: 60, color_ref: 30 },
    composition_ref: { wide: 30, lighting_ref: 30 },
    color_ref: { texture_ref: 30, detail: 20 },
  };

  const partial = RELATED[target]?.[st] ?? 0;
  return {
    score: partial,
    eligible: partial > 0,
    reason: partial > 0 ? `Partial slot match: ${st} → ${target} (${partial})` : `No match: ${st} vs ${target}`,
  };
}

function scoreAspectFit(image: ProjectImage, expectedAR: AspectRatio): { score: number; reason: string } {
  const w = (image as any).width as number | null;
  const h = (image as any).height as number | null;
  if (!w || !h) return { score: 50, reason: 'No dimensions — neutral aspect score' };

  const imageRatio = w / h;
  const [arW, arH] = expectedAR.split(':').map(Number);
  const expectedRatio = arW / arH;

  const diff = Math.abs(imageRatio - expectedRatio);
  if (diff < 0.05) return { score: 100, reason: `Aspect ratio matches ${expectedAR}` };
  if (diff < 0.15) return { score: 70, reason: `Aspect ratio close to ${expectedAR}` };
  if (diff < 0.3) return { score: 40, reason: `Aspect ratio moderately off from ${expectedAR}` };
  return { score: 10, reason: `Aspect ratio far from ${expectedAR} (ratio: ${imageRatio.toFixed(2)})` };
}

function scorePortraitSuitability(image: ProjectImage): { score: number; isPortraitSafe: boolean; reason: string } {
  const w = (image as any).width as number | null;
  const h = (image as any).height as number | null;

  if (!w || !h) return { score: 30, isPortraitSafe: false, reason: 'No dimensions — cannot determine orientation' };

  const ratio = h / w;

  // True portrait: h > w (ratio > 1.0)
  if (ratio >= 1.5) return { score: 100, isPortraitSafe: true, reason: 'Strong portrait orientation (≥3:2)' };
  if (ratio >= 1.2) return { score: 85, isPortraitSafe: true, reason: 'Portrait orientation (≥6:5)' };
  if (ratio >= 1.0) return { score: 65, isPortraitSafe: true, reason: 'Square-ish portrait (≥1:1)' };

  // Landscape — penalized
  if (ratio >= 0.8) return { score: 30, isPortraitSafe: false, reason: 'Mild landscape — not portrait-safe' };
  return { score: 5, isPortraitSafe: false, reason: 'Strong landscape — not portrait-safe' };
}

function scoreCurationQuality(image: ProjectImage): { score: number; reason: string } {
  // Use evaluation_score if available from the image metadata
  const evalScore = (image as any).evaluation_score as number | null;
  if (evalScore != null && evalScore > 0) {
    return { score: Math.min(100, evalScore), reason: `Evaluation score: ${evalScore}` };
  }

  const verdict = (image as any).governance_verdict as string | null;
  if (verdict === 'approved') return { score: 90, reason: 'Governance: approved' };
  if (verdict === 'review_required') return { score: 60, reason: 'Governance: review_required' };
  if (verdict === 'flagged') return { score: 20, reason: 'Governance: flagged' };
  if (verdict === 'rejected') return { score: 0, reason: 'Governance: rejected' };

  return { score: 50, reason: 'No governance verdict — neutral' };
}

function scoreBindingFidelity(image: ProjectImage, slot: SlotTarget): { score: number; reason: string } {
  const precision = (image as any).entity_binding_precision as string | null;
  const boundTarget = (image as any).bound_entity_name as string | null;

  // Exact entity binding
  if (precision === 'exact' && boundTarget && slot.subject && boundTarget === slot.subject) {
    return { score: 100, reason: `Exact entity binding: ${boundTarget}` };
  }
  if (precision === 'exact') return { score: 85, reason: 'Exact binding (different target)' };
  if (precision === 'derived') return { score: 60, reason: 'Derived binding' };
  if (precision === 'heuristic') return { score: 40, reason: 'Heuristic binding' };

  // Subject match without precision metadata
  if (slot.subject && image.subject === slot.subject) {
    return { score: 70, reason: `Subject match: ${slot.subject}` };
  }

  // No binding info
  if (!slot.subject) return { score: 60, reason: 'Slot has no target subject — neutral' };
  return { score: 20, reason: 'No entity binding detected' };
}

function scoreFreshness(image: ProjectImage, allImages: ProjectImage[]): { score: number; reason: string } {
  if (allImages.length <= 1) return { score: 80, reason: 'Only candidate' };

  const timestamps = allImages.map(i => new Date(i.created_at).getTime()).sort((a, b) => a - b);
  const myTime = new Date(image.created_at).getTime();
  const oldest = timestamps[0];
  const newest = timestamps[timestamps.length - 1];
  const range = newest - oldest;

  if (range === 0) return { score: 80, reason: 'All same age' };

  const normalised = (myTime - oldest) / range; // 0 = oldest, 1 = newest
  const score = Math.round(40 + normalised * 60); // 40–100
  return { score, reason: `Freshness: ${Math.round(normalised * 100)}% newest` };
}

// ── Main Scoring ──

/**
 * Score a single candidate image against a target slot.
 */
export function scoreCandidateForSlot(
  image: ProjectImage,
  slot: SlotTarget,
  allSlotCandidates: ProjectImage[],
  isVerticalDrama: boolean,
): ScoredSlotCandidate {
  const weights = isVerticalDrama ? WEIGHTS_VERTICAL_DRAMA : WEIGHTS_STANDARD;
  const reasons: string[] = [];

  const slotMatch = scoreSlotMatch(image.shot_type, slot.shotType);
  reasons.push(slotMatch.reason);

  const aspectFit = scoreAspectFit(image, slot.expectedAspectRatio);
  reasons.push(aspectFit.reason);

  const portrait = scorePortraitSuitability(image);
  reasons.push(portrait.reason);

  const curation = scoreCurationQuality(image);
  reasons.push(curation.reason);

  const binding = scoreBindingFidelity(image, slot);
  reasons.push(binding.reason);

  const freshness = scoreFreshness(image, allSlotCandidates);
  reasons.push(freshness.reason);

  const weighted =
    slotMatch.score * weights.slotMatch +
    aspectFit.score * weights.aspectFit +
    portrait.score * weights.portraitSuitability +
    curation.score * weights.curationQuality +
    binding.score * weights.bindingFidelity +
    freshness.score * weights.freshness;

  const totalScore = Math.round(weighted);

  return {
    imageId: image.id,
    slotKey: slot.key,
    totalScore,
    components: {
      slotMatch: slotMatch.score,
      aspectFit: aspectFit.score,
      portraitSuitability: portrait.score,
      curationQuality: curation.score,
      bindingFidelity: binding.score,
      freshness: freshness.score,
    },
    isPortraitSafe: portrait.isPortraitSafe,
    eligible: slotMatch.eligible,
    reasons,
  };
}

/**
 * Rank all candidates for a slot, return deterministic winner.
 * For vertical drama: landscape images are excluded from winning.
 */
export function selectSlotWinner(
  candidates: ProjectImage[],
  slot: SlotTarget,
  isVerticalDrama: boolean,
): SlotWinnerResult {
  if (candidates.length === 0) {
    return { slotKey: slot.key, winner: null, allScored: [], noWinnerReason: 'No candidates' };
  }

  const scored = candidates
    .map(img => scoreCandidateForSlot(img, slot, candidates, isVerticalDrama))
    .filter(s => s.eligible);

  if (scored.length === 0) {
    return { slotKey: slot.key, winner: null, allScored: [], noWinnerReason: 'No eligible candidates for this slot type' };
  }

  // For vertical drama: hard-filter non-portrait images
  let eligiblePool = scored;
  if (isVerticalDrama) {
    const portraitOnly = scored.filter(s => s.isPortraitSafe);
    if (portraitOnly.length > 0) {
      eligiblePool = portraitOnly;
    }
    // If no portrait-safe images exist, fall back to all eligible but log warning
  }

  // Deterministic sort: score desc → created_at desc → id asc
  eligiblePool.sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    // Tiebreak by image id for determinism
    return a.imageId.localeCompare(b.imageId);
  });

  return {
    slotKey: slot.key,
    winner: eligiblePool[0],
    allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
    noWinnerReason: null,
  };
}

/**
 * Run scoring across ALL slots, returning one winner per slot.
 */
export function scoreAndSelectAllSlots(
  slots: SlotTarget[],
  imagesBySlotKey: Map<string, ProjectImage[]>,
  isVerticalDrama: boolean,
): SlotWinnerResult[] {
  return slots.map(slot => {
    const candidates = imagesBySlotKey.get(slot.key) || [];
    return selectSlotWinner(candidates, slot, isVerticalDrama);
  });
}
