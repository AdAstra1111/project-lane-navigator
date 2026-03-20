/**
 * Canon Rebuild Scoring Engine — General-purpose slot scorer for Full Canon Rebuild.
 *
 * Uses classifyVerticalCompliance from verticalCompliance.ts as THE
 * canonical compliance evaluator. No separate "portrait-safe" heuristics.
 *
 * Scoring components:
 *   1. slot_match       — does shot_type match target? (0.30)
 *   2. aspect_fit       — correct aspect ratio for slot? (0.15)
 *   3. vertical_compliance — strict VD compliance score (0.25 when VD, else 0.00)
 *   4. curation_quality — governance verdict (0.10)
 *   5. binding_fidelity — entity binding precision (0.15)
 *   6. freshness        — newer images preferred (0.10)
 *
 * Returns deterministic ranking per slot with exactly one winner.
 * For vertical drama: non-compliant images are HARD EXCLUDED, no fallback.
 */

import type { ProjectImage } from './types';
import { SHOT_ASPECT_RATIO, type AspectRatio } from './requiredVisualSet';
import {
  classifyVerticalCompliance,
  complianceGateForAttachment,
  type VerticalComplianceResult,
  type VerticalComplianceLevel,
} from './verticalCompliance';

// ── Types ──

export interface SlotTarget {
  key: string;
  assetGroup: string;
  subject: string | null;
  shotType: string;
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
    verticalCompliance: number;
    curationQuality: number;
    bindingFidelity: number;
    freshness: number;
  };
  /** Strict VD compliance classification */
  complianceLevel: VerticalComplianceLevel;
  /** Whether this image is eligible for winner selection in current project context */
  eligibleForSelection: boolean;
  eligible: boolean;
  reasons: string[];
}

export interface SlotWinnerResult {
  slotKey: string;
  winner: ScoredSlotCandidate | null;
  allScored: ScoredSlotCandidate[];
  noWinnerReason: string | null;
  /** Compliance gate result for the winner (null if no winner) */
  complianceGate: { allowed: boolean; reason: string } | null;
}

// ── Weights ──

const WEIGHTS_STANDARD = {
  slotMatch: 0.35,
  aspectFit: 0.15,
  verticalCompliance: 0.00,
  curationQuality: 0.15,
  bindingFidelity: 0.20,
  freshness: 0.15,
};

const WEIGHTS_VERTICAL_DRAMA = {
  slotMatch: 0.25,
  aspectFit: 0.10,
  verticalCompliance: 0.25,
  curationQuality: 0.10,
  bindingFidelity: 0.15,
  freshness: 0.15,
};

const WEIGHTS_VERTICAL_DRAMA_NO_DIMS = {
  slotMatch: 0.35,
  aspectFit: 0.00,
  verticalCompliance: 0.15,
  curationQuality: 0.15,
  bindingFidelity: 0.25,
  freshness: 0.10,
};

const WEIGHTS_STANDARD_NO_DIMS = {
  slotMatch: 0.40,
  aspectFit: 0.00,
  verticalCompliance: 0.00,
  curationQuality: 0.20,
  bindingFidelity: 0.25,
  freshness: 0.15,
};

// ── Scoring Functions ──

function scoreSlotMatch(imageShotType: string | null, targetShotType: string): { score: number; eligible: boolean; reason: string } {
  const st = (imageShotType || '').toLowerCase();
  const target = targetShotType.toLowerCase();

  if (st === target) {
    return { score: 100, eligible: true, reason: `Exact slot match: ${target}` };
  }

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
  const w = image.width as number | null;
  const h = image.height as number | null;
  if (!w || !h) {
    const shotAR = SHOT_ASPECT_RATIO[(image.shot_type || '') as string];
    if (shotAR === expectedAR) return { score: 80, reason: `No dims but shot_type matches expected AR ${expectedAR}` };
    if (shotAR) return { score: 40, reason: `No dims; shot_type AR ${shotAR} ≠ expected ${expectedAR}` };
    return { score: 50, reason: 'No dimensions — neutral aspect score' };
  }

  const imageRatio = w / h;
  const [arW, arH] = expectedAR.split(':').map(Number);
  const expectedRatio = arW / arH;

  const diff = Math.abs(imageRatio - expectedRatio);
  if (diff < 0.05) return { score: 100, reason: `Aspect ratio matches ${expectedAR}` };
  if (diff < 0.15) return { score: 70, reason: `Aspect ratio close to ${expectedAR}` };
  if (diff < 0.3) return { score: 40, reason: `Aspect ratio moderately off from ${expectedAR}` };
  return { score: 10, reason: `Aspect ratio far from ${expectedAR} (ratio: ${imageRatio.toFixed(2)})` };
}

function scoreVerticalCompliance(
  image: ProjectImage,
  slotShotType: string,
  projectFormat: string,
  projectLane: string,
): { score: number; compliance: VerticalComplianceResult; reason: string } {
  const result = classifyVerticalCompliance(image, slotShotType, projectFormat, projectLane);

  const LEVEL_SCORES: Record<VerticalComplianceLevel, number> = {
    strict_vertical_compliant: 100,
    portrait_only: 30,
    square: 10,
    non_compliant: 0,
    unknown_unmeasured: 0,
  };

  return {
    score: LEVEL_SCORES[result.level],
    compliance: result,
    reason: `VD compliance: ${result.level} — ${result.reason}`,
  };
}

function scoreCurationQuality(image: ProjectImage): { score: number; reason: string } {
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

  if (precision === 'exact' && boundTarget && slot.subject && boundTarget === slot.subject) {
    return { score: 100, reason: `Exact entity binding: ${boundTarget}` };
  }
  if (precision === 'exact') return { score: 85, reason: 'Exact binding (different target)' };
  if (precision === 'derived') return { score: 60, reason: 'Derived binding' };
  if (precision === 'heuristic') return { score: 40, reason: 'Heuristic binding' };

  if (slot.subject && image.subject === slot.subject) {
    return { score: 70, reason: `Subject match: ${slot.subject}` };
  }

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

  const normalised = (myTime - oldest) / range;
  const score = Math.round(40 + normalised * 60);
  return { score, reason: `Freshness: ${Math.round(normalised * 100)}% newest` };
}

// ── Main Scoring ──

export function scoreCandidateForSlot(
  image: ProjectImage,
  slot: SlotTarget,
  allSlotCandidates: ProjectImage[],
  isVerticalDrama: boolean,
  projectFormat = '',
  projectLane = '',
): ScoredSlotCandidate {
  const hasDims = !!(image.width && image.height);
  const weights = isVerticalDrama
    ? (hasDims ? WEIGHTS_VERTICAL_DRAMA : WEIGHTS_VERTICAL_DRAMA_NO_DIMS)
    : (hasDims ? WEIGHTS_STANDARD : WEIGHTS_STANDARD_NO_DIMS);
  const reasons: string[] = [];

  const slotMatch = scoreSlotMatch(image.shot_type, slot.shotType);
  reasons.push(slotMatch.reason);

  const aspectFit = scoreAspectFit(image, slot.expectedAspectRatio);
  reasons.push(aspectFit.reason);

  const vdCompliance = scoreVerticalCompliance(
    image, slot.shotType,
    projectFormat || (isVerticalDrama ? 'vertical-drama' : 'film'),
    projectLane || (isVerticalDrama ? 'vertical_drama' : ''),
  );
  reasons.push(vdCompliance.reason);

  const curation = scoreCurationQuality(image);
  reasons.push(curation.reason);

  const binding = scoreBindingFidelity(image, slot);
  reasons.push(binding.reason);

  const freshness = scoreFreshness(image, allSlotCandidates);
  reasons.push(freshness.reason);

  const weighted =
    slotMatch.score * weights.slotMatch +
    aspectFit.score * weights.aspectFit +
    vdCompliance.score * weights.verticalCompliance +
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
      verticalCompliance: vdCompliance.score,
      curationQuality: curation.score,
      bindingFidelity: binding.score,
      freshness: freshness.score,
    },
    complianceLevel: vdCompliance.compliance.level,
    eligibleForSelection: vdCompliance.compliance.eligibleForWinnerSelection,
    eligible: slotMatch.eligible,
    reasons,
  };
}

/**
 * Rank all candidates for a slot, return deterministic winner.
 *
 * For vertical drama: NON-COMPLIANT IMAGES ARE HARD EXCLUDED.
 * If no compliant candidate exists, the slot remains UNRESOLVED.
 * There is NO fallback to landscape/non-compliant images.
 *
 * After selecting a winner, runs the compliance attachment gate
 * as a final verification before confirming eligibility.
 */
export function selectSlotWinner(
  candidates: ProjectImage[],
  slot: SlotTarget,
  isVerticalDrama: boolean,
  projectFormat = '',
  projectLane = '',
): SlotWinnerResult {
  if (candidates.length === 0) {
    return { slotKey: slot.key, winner: null, allScored: [], noWinnerReason: 'No candidates', complianceGate: null };
  }

  const scored = candidates
    .map(img => scoreCandidateForSlot(img, slot, candidates, isVerticalDrama, projectFormat, projectLane))
    .filter(s => s.eligible);

  if (scored.length === 0) {
    return { slotKey: slot.key, winner: null, allScored: [], noWinnerReason: 'No eligible candidates for this slot type', complianceGate: null };
  }

  // ── VERTICAL DRAMA HARD FILTER — no fallback ──
  let eligiblePool = scored;
  if (isVerticalDrama) {
    const compliantOnly = scored.filter(s => s.eligibleForSelection);
    if (compliantOnly.length > 0) {
      eligiblePool = compliantOnly;
    } else {
      // HARD EXCLUSION: no compliant images → slot unresolved
      const rejectedLevels = scored.map(s => s.complianceLevel);
      return {
        slotKey: slot.key,
        winner: null,
        allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
        noWinnerReason: `No vertical-compliant candidates (${scored.length} scored: ${rejectedLevels.join(', ')})`,
        complianceGate: { allowed: false, reason: 'All candidates failed strict vertical compliance' },
      };
    }
  }

  // Deterministic sort: score desc → id asc
  eligiblePool.sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    return a.imageId.localeCompare(b.imageId);
  });

  const winner = eligiblePool[0];

  // ── Final compliance gate before confirming winner ──
  const winnerImage = candidates.find(c => c.id === winner.imageId);
  let gate: { allowed: boolean; reason: string } | null = null;
  if (winnerImage && isVerticalDrama) {
    const gateResult = complianceGateForAttachment(
      winnerImage, slot.shotType, projectFormat, projectLane,
    );
    gate = { allowed: gateResult.allowed, reason: gateResult.reason };
    if (!gateResult.allowed) {
      // Gate blocked — slot unresolved
      return {
        slotKey: slot.key,
        winner: null,
        allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
        noWinnerReason: `Winner blocked by compliance gate: ${gateResult.reason}`,
        complianceGate: gate,
      };
    }
  }

  return {
    slotKey: slot.key,
    winner,
    allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
    noWinnerReason: null,
    complianceGate: gate,
  };
}

/**
 * Run scoring across ALL slots, returning one winner per slot.
 */
export function scoreAndSelectAllSlots(
  slots: SlotTarget[],
  imagesBySlotKey: Map<string, ProjectImage[]>,
  isVerticalDrama: boolean,
  projectFormat = '',
  projectLane = '',
): SlotWinnerResult[] {
  return slots.map(slot => {
    const candidates = imagesBySlotKey.get(slot.key) || [];
    return selectSlotWinner(candidates, slot, isVerticalDrama, projectFormat, projectLane);
  });
}
