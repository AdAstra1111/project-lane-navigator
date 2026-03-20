/**
 * Identity Alignment Scoring Engine — Deterministic ranking of candidate
 * identity images per character slot using governed visual truth inputs.
 *
 * Scoring is:
 *   - deterministic and reproducible
 *   - explainable (every score has reasons)
 *   - shot-aware (markers only count when body region is visible)
 *   - transient-state-safe (transients never count as permanent identity)
 *   - legacy-compatible (both direct and composite identity_signature)
 *
 * Component scores (each 0–100):
 *   1. slot_match       — does the image's shot_type fit the target slot?
 *   2. identity_sig     — does metadata align with the identity signature?
 *   3. marker_score     — approved persistent markers present when applicable?
 *   4. continuity       — alignment with currently locked primaries?
 *   5. shot_correctness — shot quality / framing / purpose alignment
 *   6. style_compliance — lane/VSAL compliance where available
 *   7. evaluation_score — existing image evaluation governance verdict
 *   8. penalty          — deductions for contradictions, drift, etc.
 *
 * Weights are documented and deterministic. Missing data degrades score
 * honestly rather than fabricating confidence.
 */

import type { ProjectImage, ShotType } from './types';
import type { CharacterVisualDNA, VisualDNATrait } from './visualDNA';
import { deserializeIdentitySignature } from './visualDNA';
import type { IdentitySignature } from './identitySignature';
import { hasIdentitySignature } from './identitySignature';
import type { BindingMarker } from './characterTraits';
import { isMarkerApplicableForShot } from './characterTraits';
import type { ImageEvaluation, GovernanceVerdict, MatchLevel } from './imageEvaluation';

// ── Types ──

export type IdentitySlot = 'identity_headshot' | 'identity_profile' | 'identity_full_body';

export const IDENTITY_SLOTS: IdentitySlot[] = ['identity_headshot', 'identity_profile', 'identity_full_body'];

export const SLOT_LABELS: Record<IdentitySlot, string> = {
  identity_headshot: 'Headshot',
  identity_profile: 'Profile',
  identity_full_body: 'Full Body',
};

export type RecommendedAction = 'promote' | 'retain_candidate' | 'reject_for_slot' | 'insufficient_data';

export interface ComponentScores {
  slotMatch: number;
  identitySig: number;
  markerScore: number;
  continuity: number;
  shotCorrectness: number;
  styleCompliance: number;
  evaluationScore: number;
  penalty: number;
}

export interface ScoredCandidate {
  candidateId: string;
  slot: IdentitySlot;
  totalScore: number;
  componentScores: ComponentScores;
  recommendedAction: RecommendedAction;
  eligible: boolean;
  /** True only when shot_type exactly matches the target slot — safe for canonical primary promotion */
  canonPromotable: boolean;
  reasons: string[];
  warnings: string[];
  confidence: 'high' | 'medium' | 'low';
}

export interface SlotRecommendation {
  slot: IdentitySlot;
  bestCandidate: ScoredCandidate | null;
  rankedCandidates: ScoredCandidate[];
  noRecommendationReason: string | null;
}

export interface CharacterAlignmentResult {
  characterName: string;
  slots: SlotRecommendation[];
  overallConfidence: 'high' | 'medium' | 'low';
  summaryWarnings: string[];
}

// ── Weights ──
// Total possible = 100 when all components score 100.
// Weights are proportional contributions.

const WEIGHTS = {
  slotMatch:        0.25,  // Most critical — wrong slot = ineligible
  identitySig:      0.15,  // Signature alignment
  markerScore:      0.15,  // Approved marker compliance
  continuity:       0.15,  // Alignment with locked set
  shotCorrectness:  0.10,  // Framing/purpose quality
  styleCompliance:  0.10,  // Lane/style fit
  evaluationScore:  0.10,  // Existing governance verdict
} as const;

// ── Slot Match ──

/**
 * Score how well an image's shot_type matches the target identity slot.
 * Returns 0–100. An exact match = 100. Related shots get partial credit.
 * Fundamentally wrong shots = 0 (ineligible).
 */
function scoreSlotMatch(imageShotType: string | null, targetSlot: IdentitySlot): { score: number; eligible: boolean; exactMatch: boolean; reason: string } {
  const st = (imageShotType || '').toLowerCase();

  if (st === targetSlot) {
    return { score: 100, eligible: true, reason: `Exact slot match: ${targetSlot}` };
  }

  // Cross-slot partial credit rules
  const PARTIAL: Record<IdentitySlot, Record<string, number>> = {
    identity_headshot: {
      close_up: 60, medium: 20, profile: 15,
    },
    identity_profile: {
      profile: 70, close_up: 15, medium: 15,
    },
    identity_full_body: {
      full_body: 70, medium: 25, wide: 15,
    },
  };

  const partialScore = PARTIAL[targetSlot]?.[st];
  if (partialScore !== undefined) {
    return { score: partialScore, eligible: partialScore >= 20, reason: `Partial slot fit: ${st} for ${targetSlot} (${partialScore}%)` };
  }

  return { score: 0, eligible: false, reason: `Shot type "${st || 'unknown'}" incompatible with ${targetSlot}` };
}

// ── Identity Signature Match ──

/**
 * Score alignment between candidate's generation context and the persisted identity signature.
 * Missing signature = 50 (neutral, not penalized).
 */
function scoreIdentitySignature(
  image: ProjectImage,
  signature: IdentitySignature | null,
): { score: number; reason: string } {
  if (!signature || !hasIdentitySignature(signature)) {
    return { score: 50, reason: 'No identity signature available — neutral score' };
  }

  const prompt = (image.prompt_used || '').toLowerCase();
  let matches = 0;
  let checks = 0;

  // Check face components in prompt
  const faceFields = [signature.face.jawShape, signature.face.cheekboneStructure, signature.face.noseProfile, signature.face.eyeSpacing];
  for (const f of faceFields) {
    if (!f) continue;
    checks++;
    const words = f.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => prompt.includes(w))) matches++;
  }

  // Check body
  if (signature.body.build) {
    checks++;
    if (prompt.includes(signature.body.build.toLowerCase())) matches++;
  }
  if (signature.body.heightClass) {
    checks++;
    if (prompt.includes(signature.body.heightClass)) matches++;
  }

  // Check distinctive features
  for (const feat of signature.face.distinctiveFeatures) {
    checks++;
    const words = feat.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.some(w => prompt.includes(w))) matches++;
  }

  if (checks === 0) return { score: 50, reason: 'Identity signature has no scoreable fields' };

  const ratio = matches / checks;
  const score = Math.round(ratio * 100);
  return { score, reason: `Signature alignment: ${matches}/${checks} fields present in prompt (${score}%)` };
}

// ── Approved Marker Score ──

/**
 * Score whether approved persistent markers are present in the candidate's prompt
 * when applicable for the shot type. Transient states are excluded.
 * Only approved markers count.
 */
function scoreApprovedMarkers(
  image: ProjectImage,
  markers: BindingMarker[],
  targetSlot: IdentitySlot,
): { score: number; reasons: string[] } {
  const approved = markers.filter(m => m.status === 'approved');
  if (approved.length === 0) {
    return { score: 50, reasons: ['No approved markers — neutral'] };
  }

  const prompt = (image.prompt_used || '').toLowerCase();
  const reasons: string[] = [];
  let applicable = 0;
  let satisfied = 0;

  for (const m of approved) {
    if (!isMarkerApplicableForShot(m, targetSlot)) {
      reasons.push(`[MARKER] ${m.label} — N/A for ${targetSlot}`);
      continue;
    }
    applicable++;
    const inPrompt = prompt.includes(m.markerType.toLowerCase()) || prompt.includes(m.label.toLowerCase());
    if (inPrompt) {
      satisfied++;
      reasons.push(`[MARKER] ${m.label} — present ✓`);
    } else {
      reasons.push(`[MARKER] ${m.label} — MISSING from prompt`);
    }
  }

  if (applicable === 0) {
    return { score: 50, reasons: [...reasons, 'No markers applicable for this shot — neutral'] };
  }

  const score = Math.round((satisfied / applicable) * 100);
  return { score, reasons };
}

// ── Continuity Score ──

/**
 * Score alignment with currently locked primaries (model/provider consistency,
 * generation with identity lock).
 */
function scoreContinuity(
  image: ProjectImage,
  currentPrimaries: ProjectImage[],
): { score: number; reason: string } {
  if (currentPrimaries.length === 0) {
    return { score: 50, reason: 'No locked primaries yet — neutral continuity' };
  }

  let score = 50; // baseline
  const genConfig = (image.generation_config || {}) as Record<string, unknown>;

  // Identity lock enforcement
  if (genConfig.identity_locked || genConfig.identity_anchor_paths) {
    score += 30;
  }

  // Model consistency
  const primaryModels = new Set(currentPrimaries.map(p => p.model));
  if (primaryModels.has(image.model)) {
    score += 10;
  }

  // Provider consistency
  const primaryProviders = new Set(currentPrimaries.map(p => p.provider));
  if (primaryProviders.has(image.provider)) {
    score += 10;
  }

  return { score: Math.min(100, score), reason: `Continuity: model=${primaryModels.has(image.model) ? 'match' : 'diff'}, lock=${genConfig.identity_locked ? 'yes' : 'no'}` };
}

// ── Shot Correctness ──

/**
 * Score generation purpose and asset group alignment.
 */
function scoreShotCorrectness(image: ProjectImage): { score: number; reason: string } {
  let score = 50;

  if (image.generation_purpose === 'character_identity') score += 30;
  else if (image.asset_group === 'character') score += 15;

  if (image.curation_state === 'active') score += 20;
  else if (image.curation_state === 'candidate') score += 10;
  else if (image.curation_state === 'rejected') score -= 30;

  return { score: Math.max(0, Math.min(100, score)), reason: `Purpose: ${image.generation_purpose || 'unset'}, curation: ${image.curation_state}` };
}

// ── Style / Lane Compliance ──

/**
 * Score lane/style compliance from image metadata.
 * VSAL is non-blocking — absence = neutral.
 */
function scoreStyleCompliance(image: ProjectImage): { score: number; reason: string } {
  // Use lane_compliance_score if available
  if (image.lane_compliance_score != null) {
    const s = Math.max(0, Math.min(100, image.lane_compliance_score));
    return { score: s, reason: `Lane compliance score: ${s}` };
  }

  // Prestige style present = slight bonus
  if (image.prestige_style) {
    return { score: 60, reason: `Has prestige style: ${image.prestige_style}` };
  }

  return { score: 50, reason: 'No style metadata — neutral' };
}

// ── Evaluation Integration ──

/**
 * Incorporate existing governance verdict from image_evaluations.
 */
function scoreFromEvaluation(evaluation: ImageEvaluation | null): { score: number; reason: string } {
  if (!evaluation) {
    return { score: 50, reason: 'No evaluation available — neutral' };
  }

  const verdictScores: Record<GovernanceVerdict, number> = {
    approved: 100,
    review_required: 60,
    pending: 50,
    flagged: 25,
    rejected: 0,
  };

  const base = verdictScores[evaluation.governanceVerdict] ?? 50;

  // Bonus for high canon match
  const matchBonus: Record<MatchLevel, number> = { high: 10, medium: 5, low: -5, unknown: 0 };
  const bonus = matchBonus[evaluation.canonMatch] ?? 0;

  const score = Math.max(0, Math.min(100, base + bonus));
  return { score, reason: `Governance: ${evaluation.governanceVerdict}, canon: ${evaluation.canonMatch}` };
}

// ── Penalty ──

/**
 * Compute penalty deductions.
 */
function computePenalty(image: ProjectImage, dna: CharacterVisualDNA | null): { penalty: number; reasons: string[] } {
  let penalty = 0;
  const reasons: string[] = [];

  // Rejected curation state
  if (image.curation_state === 'rejected') {
    penalty += 40;
    reasons.push('Image curation state is rejected (-40)');
  }
  if (image.curation_state === 'archived') {
    penalty += 20;
    reasons.push('Image is archived (-20)');
  }

  // No prompt at all
  if (!image.prompt_used || image.prompt_used.trim().length < 10) {
    penalty += 15;
    reasons.push('No meaningful prompt recorded (-15)');
  }

  return { penalty: Math.min(penalty, 80), reasons };
}

// ── Main Scoring Function ──

/**
 * Score a single candidate image for a target identity slot.
 * Pure function — no side effects, no database calls.
 */
export function scoreCandidate(
  image: ProjectImage,
  targetSlot: IdentitySlot,
  dna: CharacterVisualDNA | null,
  identitySignature: IdentitySignature | null,
  currentPrimaries: ProjectImage[],
  evaluation: ImageEvaluation | null,
): ScoredCandidate {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1. Slot match (eligibility gate)
  const slotResult = scoreSlotMatch(image.shot_type, targetSlot);
  reasons.push(slotResult.reason);

  if (!slotResult.eligible) {
    return {
      candidateId: image.id,
      slot: targetSlot,
      totalScore: 0,
      componentScores: {
        slotMatch: slotResult.score,
        identitySig: 0, markerScore: 0, continuity: 0,
        shotCorrectness: 0, styleCompliance: 0, evaluationScore: 0, penalty: 0,
      },
      recommendedAction: 'reject_for_slot',
      eligible: false,
      reasons,
      warnings: ['Ineligible: shot type does not match target slot'],
      confidence: 'high',
    };
  }

  // 2. Identity signature
  const sigResult = scoreIdentitySignature(image, identitySignature);
  reasons.push(sigResult.reason);

  // 3. Approved markers
  const markers = dna?.bindingMarkers || [];
  const markerResult = scoreApprovedMarkers(image, markers, targetSlot);
  reasons.push(...markerResult.reasons);

  // 4. Continuity
  const contResult = scoreContinuity(image, currentPrimaries);
  reasons.push(contResult.reason);

  // 5. Shot correctness
  const shotResult = scoreShotCorrectness(image);
  reasons.push(shotResult.reason);

  // 6. Style compliance
  const styleResult = scoreStyleCompliance(image);
  reasons.push(styleResult.reason);

  // 7. Evaluation
  const evalResult = scoreFromEvaluation(evaluation);
  reasons.push(evalResult.reason);

  // 8. Penalty
  const penResult = computePenalty(image, dna);
  reasons.push(...penResult.reasons);
  if (penResult.reasons.length > 0) warnings.push(...penResult.reasons);

  // Weighted total
  const weighted =
    slotResult.score * WEIGHTS.slotMatch +
    sigResult.score * WEIGHTS.identitySig +
    markerResult.score * WEIGHTS.markerScore +
    contResult.score * WEIGHTS.continuity +
    shotResult.score * WEIGHTS.shotCorrectness +
    styleResult.score * WEIGHTS.styleCompliance +
    evalResult.score * WEIGHTS.evaluationScore;

  const totalScore = Math.max(0, Math.round(weighted - penResult.penalty));

  // Determine confidence
  const hasRealData = dna != null || evaluation != null || identitySignature != null;
  const confidence: 'high' | 'medium' | 'low' =
    hasRealData && slotResult.score >= 60 ? 'high' :
    slotResult.score >= 20 ? 'medium' : 'low';

  // Recommended action
  let recommendedAction: RecommendedAction;
  if (totalScore >= 70 && confidence !== 'low') {
    recommendedAction = 'promote';
  } else if (totalScore >= 40) {
    recommendedAction = 'retain_candidate';
  } else if (!hasRealData) {
    recommendedAction = 'insufficient_data';
  } else {
    recommendedAction = 'reject_for_slot';
  }

  // Warnings
  if (!dna) warnings.push('No Visual DNA resolved — scoring degraded');
  if (!identitySignature) warnings.push('No identity signature — signature match unavailable');
  if (markers.filter(m => m.status === 'approved').length === 0 && markers.length > 0) {
    warnings.push('Markers exist but none approved — marker scoring neutral');
  }

  return {
    candidateId: image.id,
    slot: targetSlot,
    totalScore,
    componentScores: {
      slotMatch: slotResult.score,
      identitySig: sigResult.score,
      markerScore: markerResult.score,
      continuity: contResult.score,
      shotCorrectness: shotResult.score,
      styleCompliance: styleResult.score,
      evaluationScore: evalResult.score,
      penalty: penResult.penalty,
    },
    recommendedAction,
    eligible: slotResult.eligible,
    reasons,
    warnings,
    confidence,
  };
}

// ── Recommendation Helper ──

/**
 * Rank all candidates for a single slot. Deterministic ordering:
 * 1. total_score descending
 * 2. created_at descending (newest first as tiebreaker)
 * 3. id ascending (final deterministic tiebreaker)
 */
export function rankCandidatesForSlot(
  candidates: ProjectImage[],
  targetSlot: IdentitySlot,
  dna: CharacterVisualDNA | null,
  identitySignature: IdentitySignature | null,
  currentPrimaries: ProjectImage[],
  evaluations: Map<string, ImageEvaluation>,
): SlotRecommendation {
  if (candidates.length === 0) {
    return {
      slot: targetSlot,
      bestCandidate: null,
      rankedCandidates: [],
      noRecommendationReason: 'No candidate images available for this slot',
    };
  }

  const scored = candidates.map(img =>
    scoreCandidate(img, targetSlot, dna, identitySignature, currentPrimaries, evaluations.get(img.id) || null),
  );

  // Deterministic sort
  scored.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    // Tiebreaker: find original images for date comparison
    const imgA = candidates.find(c => c.id === a.candidateId);
    const imgB = candidates.find(c => c.id === b.candidateId);
    const dateA = imgA ? new Date(imgA.created_at).getTime() : 0;
    const dateB = imgB ? new Date(imgB.created_at).getTime() : 0;
    if (dateB !== dateA) return dateB - dateA;
    return a.candidateId.localeCompare(b.candidateId);
  });

  const eligible = scored.filter(s => s.eligible);
  const best = eligible.length > 0 ? eligible[0] : null;

  let noRecommendationReason: string | null = null;
  if (!best) {
    noRecommendationReason = 'No eligible candidates for this slot — all shot types incompatible';
  } else if (best.confidence === 'low') {
    noRecommendationReason = 'Best candidate has low confidence — manual review recommended';
  }

  return {
    slot: targetSlot,
    bestCandidate: best,
    rankedCandidates: scored,
    noRecommendationReason: best && best.confidence !== 'low' ? null : noRecommendationReason,
  };
}

/**
 * Full character alignment: rank candidates across all 3 identity slots.
 */
export function computeCharacterAlignment(
  characterName: string,
  allCandidates: ProjectImage[],
  dna: CharacterVisualDNA | null,
  rawIdentitySignature: Record<string, unknown> | null,
  currentPrimaries: ProjectImage[],
  evaluations: Map<string, ImageEvaluation>,
): CharacterAlignmentResult {
  // Handle both legacy and composite identity_signature
  const identitySignature = deserializeIdentitySignature(rawIdentitySignature as any);

  const summaryWarnings: string[] = [];
  if (!dna) summaryWarnings.push('No Visual DNA — scoring degraded across all slots');
  if (!identitySignature) summaryWarnings.push('No identity signature resolved');

  const slots = IDENTITY_SLOTS.map(slot => {
    // Candidates for this slot are images matching this shot_type OR close relatives
    const slotCandidates = allCandidates.filter(img => {
      const st = (img.shot_type || '').toLowerCase();
      // Include exact matches + plausible cross-slot candidates
      if (st === slot) return true;
      // Include general character shots that might fit
      if (slot === 'identity_headshot' && (st === 'close_up' || st === 'medium')) return true;
      if (slot === 'identity_profile' && (st === 'profile' || st === 'close_up')) return true;
      if (slot === 'identity_full_body' && (st === 'full_body' || st === 'medium' || st === 'wide')) return true;
      return false;
    });

    return rankCandidatesForSlot(slotCandidates, slot, dna, identitySignature, currentPrimaries, evaluations);
  });

  const filledSlots = slots.filter(s => s.bestCandidate?.confidence !== 'low' && s.bestCandidate != null).length;
  const overallConfidence: 'high' | 'medium' | 'low' =
    filledSlots === 3 ? 'high' : filledSlots >= 1 ? 'medium' : 'low';

  return {
    characterName,
    slots,
    overallConfidence,
    summaryWarnings,
  };
}
