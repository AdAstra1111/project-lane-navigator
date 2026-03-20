/**
 * Canon Rebuild Scoring Engine — General-purpose slot scorer for Full Canon Rebuild.
 *
 * Uses classifyVerticalCompliance from verticalCompliance.ts as THE
 * canonical compliance evaluator. No separate "portrait-safe" heuristics.
 *
 * Supports two canonical rebuild modes:
 *   - RESET_FULL_CANON_REBUILD: destructive rebuild from scratch
 *   - PRESERVE_PRIMARIES_FULL_CANON_REBUILD: anchored rebuild preserving incumbents
 *
 * Scoring components (standard):
 *   1. slot_match       — does shot_type match target? (0.30)
 *   2. aspect_fit       — correct aspect ratio for slot? (0.15)
 *   3. vertical_compliance — strict VD compliance score (0.25 when VD, else 0.00)
 *   4. curation_quality — governance verdict (0.10)
 *   5. binding_fidelity — entity binding precision (0.15)
 *   6. freshness        — newer images preferred (0.10)
 *
 * Preserve mode adds:
 *   7. primarySetAlignment — alignment with existing primary canon set (0.15)
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

// ── Rebuild Mode ──

export type RebuildMode = 'RESET_FULL_CANON_REBUILD' | 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD';

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
    primarySetAlignment: number;
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
  /** Whether incumbent was preserved (preserve mode) */
  incumbentPreserved: boolean;
  /** Whether incumbent was replaced by a challenger */
  incumbentReplaced: boolean;
  /** ID of the incumbent primary if one existed */
  incumbentId: string | null;
}

/** Structured rebuild result — mandatory output from any rebuild */
export interface RebuildResult {
  mode: RebuildMode;
  totalSlots: number;
  resolvedSlots: number;
  unresolvedSlots: number;
  generatedCount: number;
  compliantCount: number;
  rejectedNonCompliantCount: number;
  attachedWinnerCount: number;
  preservedPrimaryCount: number;
  replacedPrimaryCount: number;
  winnerIds: string[];
  unresolvedReasons: Array<{ slotKey: string; reason: string }>;
}

/** Anchor reference for primarySetAlignment scoring */
export interface AlignmentAnchor {
  imageId: string;
  assetGroup: string;
  subject: string | null;
  shotType: string | null;
  /** Why this anchor was selected */
  selectionReason: string;
}

// ── Slot Weakness Classification ──

export type SlotWeaknessReason =
  | 'unresolved'
  | 'missing_primary'
  | 'non_compliant'
  | 'unknown_unmeasured'
  | 'below_score_threshold';

export interface SlotWeakness {
  isWeak: boolean;
  reasons: SlotWeaknessReason[];
}

/**
 * Deterministic slot weakness classifier.
 * A slot is weak if its incumbent fails any of these conditions.
 */
export function classifySlotWeakness(
  incumbent: ProjectImage | null,
  slot: SlotTarget,
  isVerticalDrama: boolean,
  projectFormat: string,
  projectLane: string,
  scoreThreshold = 40,
): SlotWeakness {
  const reasons: SlotWeaknessReason[] = [];

  if (!incumbent) {
    return { isWeak: true, reasons: ['unresolved'] };
  }

  if (!incumbent.is_primary) {
    reasons.push('missing_primary');
  }

  if (isVerticalDrama) {
    const compliance = classifyVerticalCompliance(incumbent, slot.shotType, projectFormat, projectLane);
    if (!compliance.eligibleForWinnerSelection) {
      reasons.push('non_compliant');
    }
    if (compliance.level === 'unknown_unmeasured') {
      reasons.push('unknown_unmeasured');
    }
  }

  // Score threshold check — score incumbent against slot
  const scored = scoreCandidateForSlot(incumbent, slot, [incumbent], isVerticalDrama, projectFormat, projectLane);
  if (scored.totalScore < scoreThreshold) {
    reasons.push('below_score_threshold');
  }

  return { isWeak: reasons.length > 0, reasons };
}

// ── Replacement Threshold ──

/**
 * Explicit replacement threshold for preserve mode.
 * A challenger must beat the incumbent by this margin to replace.
 * This prevents churn from marginal improvements.
 */
export const PRESERVE_REPLACEMENT_THRESHOLD = 15;

/**
 * Determines if a challenger should replace an incumbent in preserve mode.
 * Returns deterministic, inspectable result.
 */
export function shouldReplace(
  incumbentScore: number,
  challengerScore: number,
  incumbentWeakness: SlotWeakness,
): { replace: boolean; reason: string } {
  // Always replace if incumbent is fundamentally weak
  if (incumbentWeakness.isWeak && incumbentWeakness.reasons.some(r =>
    r === 'non_compliant' || r === 'unknown_unmeasured' || r === 'unresolved' || r === 'missing_primary'
  )) {
    return { replace: true, reason: `Incumbent weak: ${incumbentWeakness.reasons.join(', ')}` };
  }

  // Replace if challenger exceeds threshold
  const margin = challengerScore - incumbentScore;
  if (margin >= PRESERVE_REPLACEMENT_THRESHOLD) {
    return { replace: true, reason: `Challenger wins by ${margin} (threshold: ${PRESERVE_REPLACEMENT_THRESHOLD})` };
  }

  return { replace: false, reason: `Incumbent preserved: margin ${margin} < threshold ${PRESERVE_REPLACEMENT_THRESHOLD}` };
}

// ── Weights ──

const WEIGHTS_STANDARD = {
  slotMatch: 0.35,
  aspectFit: 0.15,
  verticalCompliance: 0.00,
  curationQuality: 0.15,
  bindingFidelity: 0.20,
  freshness: 0.15,
  primarySetAlignment: 0.00,
};

const WEIGHTS_VERTICAL_DRAMA = {
  slotMatch: 0.25,
  aspectFit: 0.10,
  verticalCompliance: 0.25,
  curationQuality: 0.10,
  bindingFidelity: 0.15,
  freshness: 0.15,
  primarySetAlignment: 0.00,
};

const WEIGHTS_VERTICAL_DRAMA_NO_DIMS = {
  slotMatch: 0.35,
  aspectFit: 0.00,
  verticalCompliance: 0.15,
  curationQuality: 0.15,
  bindingFidelity: 0.25,
  freshness: 0.10,
  primarySetAlignment: 0.00,
};

const WEIGHTS_STANDARD_NO_DIMS = {
  slotMatch: 0.40,
  aspectFit: 0.00,
  verticalCompliance: 0.00,
  curationQuality: 0.20,
  bindingFidelity: 0.25,
  freshness: 0.15,
  primarySetAlignment: 0.00,
};

// Preserve-mode weight overrides — adds primarySetAlignment
const WEIGHTS_PRESERVE_STANDARD = {
  ...WEIGHTS_STANDARD,
  bindingFidelity: 0.15,
  freshness: 0.10,
  primarySetAlignment: 0.10,
};

const WEIGHTS_PRESERVE_VD = {
  ...WEIGHTS_VERTICAL_DRAMA,
  freshness: 0.05,
  primarySetAlignment: 0.15,
};

const WEIGHTS_PRESERVE_VD_NO_DIMS = {
  ...WEIGHTS_VERTICAL_DRAMA_NO_DIMS,
  freshness: 0.05,
  primarySetAlignment: 0.10,
};

const WEIGHTS_PRESERVE_STANDARD_NO_DIMS = {
  ...WEIGHTS_STANDARD_NO_DIMS,
  freshness: 0.10,
  primarySetAlignment: 0.10,
};

// ── Primary Set Alignment Scoring ──

/**
 * Score how well a candidate aligns with existing primary anchors.
 * Used ONLY in PRESERVE mode.
 *
 * Alignment is scoped to relevant section/slot family anchors, not whole-deck.
 */
export function scorePrimarySetAlignment(
  image: ProjectImage,
  anchors: AlignmentAnchor[],
  slot: SlotTarget,
): { score: number; reason: string; anchorsUsed: string[] } {
  if (anchors.length === 0) {
    return { score: 50, reason: 'No anchors available — neutral alignment', anchorsUsed: [] };
  }

  // Filter to relevant anchors for this slot's section
  const relevantAnchors = selectRelevantAnchors(anchors, slot);

  if (relevantAnchors.length === 0) {
    return { score: 50, reason: 'No relevant anchors for this slot section — neutral', anchorsUsed: [] };
  }

  let totalAlignment = 0;
  const usedIds: string[] = [];

  for (const anchor of relevantAnchors) {
    usedIds.push(anchor.imageId);

    // Same asset group = strong alignment signal
    if (anchor.assetGroup === image.asset_group) {
      totalAlignment += 30;
    }

    // Same subject = direct relevance
    if (anchor.subject && image.subject && anchor.subject === image.subject) {
      totalAlignment += 40;
    }

    // Same shot type family = compositional alignment
    if (anchor.shotType && image.shot_type && anchor.shotType === image.shot_type) {
      totalAlignment += 20;
    }
  }

  // Normalize to 0-100
  const maxPossible = relevantAnchors.length * 90;
  const normalized = Math.min(100, Math.round((totalAlignment / maxPossible) * 100));

  return {
    score: normalized,
    reason: `Alignment score ${normalized} from ${relevantAnchors.length} anchors`,
    anchorsUsed: usedIds,
  };
}

/**
 * Targeted anchor selection — scoped by slot/section relevance.
 * Do NOT pass the whole deck as a reference blob.
 */
export function selectRelevantAnchors(
  allAnchors: AlignmentAnchor[],
  slot: SlotTarget,
): AlignmentAnchor[] {
  // Priority 1: same asset_group + same subject
  const exactMatch = allAnchors.filter(a =>
    a.assetGroup === slot.assetGroup && a.subject === slot.subject
  );
  if (exactMatch.length > 0) return exactMatch.slice(0, 5);

  // Priority 2: same asset_group (broader section family)
  const groupMatch = allAnchors.filter(a => a.assetGroup === slot.assetGroup);
  if (groupMatch.length > 0) return groupMatch.slice(0, 5);

  // Priority 3: cross-section anchors for visual consistency
  // Only use for visual_language and key_moment which benefit from cross-ref
  if (slot.assetGroup === 'visual_language' || slot.assetGroup === 'key_moment') {
    return allAnchors.slice(0, 3);
  }

  return [];
}

/**
 * Build alignment anchors from existing primary images.
 * Used in PRESERVE mode to construct the reference set.
 */
export function buildAlignmentAnchors(primaryImages: ProjectImage[]): AlignmentAnchor[] {
  return primaryImages
    .filter(img => img.is_primary && img.curation_state === 'active')
    .map(img => ({
      imageId: img.id,
      assetGroup: img.asset_group || '',
      subject: img.subject || null,
      shotType: img.shot_type || null,
      selectionReason: 'existing_primary',
    }));
}

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
  options?: {
    mode?: RebuildMode;
    anchors?: AlignmentAnchor[];
  },
): ScoredSlotCandidate {
  const hasDims = !!(image.width && image.height);
  const isPreserve = options?.mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD';

  const weights = isPreserve
    ? (isVerticalDrama
        ? (hasDims ? WEIGHTS_PRESERVE_VD : WEIGHTS_PRESERVE_VD_NO_DIMS)
        : (hasDims ? WEIGHTS_PRESERVE_STANDARD : WEIGHTS_PRESERVE_STANDARD_NO_DIMS))
    : (isVerticalDrama
        ? (hasDims ? WEIGHTS_VERTICAL_DRAMA : WEIGHTS_VERTICAL_DRAMA_NO_DIMS)
        : (hasDims ? WEIGHTS_STANDARD : WEIGHTS_STANDARD_NO_DIMS));

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

  // primarySetAlignment — only active in preserve mode
  let alignment = { score: 0, reason: 'Not in preserve mode', anchorsUsed: [] as string[] };
  if (isPreserve && options?.anchors) {
    alignment = scorePrimarySetAlignment(image, options.anchors, slot);
    reasons.push(alignment.reason);
  }

  const weighted =
    slotMatch.score * weights.slotMatch +
    aspectFit.score * weights.aspectFit +
    vdCompliance.score * weights.verticalCompliance +
    curation.score * weights.curationQuality +
    binding.score * weights.bindingFidelity +
    freshness.score * weights.freshness +
    alignment.score * weights.primarySetAlignment;

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
      primarySetAlignment: alignment.score,
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
 * In PRESERVE mode:
 * - incumbent is evaluated against challengers
 * - replacement requires exceeding PRESERVE_REPLACEMENT_THRESHOLD
 * - weak incumbents are always replaceable
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
  options?: {
    mode?: RebuildMode;
    anchors?: AlignmentAnchor[];
    incumbent?: ProjectImage | null;
  },
): SlotWinnerResult {
  const mode = options?.mode || 'RESET_FULL_CANON_REBUILD';
  const incumbent = options?.incumbent || null;

  if (candidates.length === 0 && !incumbent) {
    return {
      slotKey: slot.key, winner: null, allScored: [],
      noWinnerReason: 'No candidates',
      complianceGate: null,
      incumbentPreserved: false, incumbentReplaced: false, incumbentId: null,
    };
  }

  const scoringOptions = { mode, anchors: options?.anchors };

  // Score all candidates
  const allCandidates = incumbent && !candidates.some(c => c.id === incumbent.id)
    ? [...candidates, incumbent]
    : candidates;

  const scored = allCandidates
    .map(img => scoreCandidateForSlot(img, slot, allCandidates, isVerticalDrama, projectFormat, projectLane, scoringOptions))
    .filter(s => s.eligible);

  if (scored.length === 0) {
    return {
      slotKey: slot.key, winner: null, allScored: [],
      noWinnerReason: 'No eligible candidates for this slot type',
      complianceGate: null,
      incumbentPreserved: false, incumbentReplaced: false,
      incumbentId: incumbent?.id || null,
    };
  }

  // ── VERTICAL DRAMA HARD FILTER — no fallback ──
  let eligiblePool = scored;
  if (isVerticalDrama) {
    const compliantOnly = scored.filter(s => s.eligibleForSelection);
    if (compliantOnly.length > 0) {
      eligiblePool = compliantOnly;
    } else {
      const rejectedLevels = scored.map(s => s.complianceLevel);
      return {
        slotKey: slot.key,
        winner: null,
        allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
        noWinnerReason: `No vertical-compliant candidates (${scored.length} scored: ${rejectedLevels.join(', ')})`,
        complianceGate: { allowed: false, reason: 'All candidates failed strict vertical compliance' },
        incumbentPreserved: false, incumbentReplaced: false,
        incumbentId: incumbent?.id || null,
      };
    }
  }

  // Deterministic sort: score desc → id asc
  eligiblePool.sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    return a.imageId.localeCompare(b.imageId);
  });

  const topCandidate = eligiblePool[0];

  // ── PRESERVE MODE: check replacement threshold ──
  if (mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD' && incumbent) {
    const incumbentScored = scored.find(s => s.imageId === incumbent.id);

    if (incumbentScored && incumbentScored.eligibleForSelection !== false) {
      const weakness = classifySlotWeakness(incumbent, slot, isVerticalDrama, projectFormat, projectLane);

      if (topCandidate.imageId !== incumbent.id) {
        const replacementCheck = shouldReplace(incumbentScored.totalScore, topCandidate.totalScore, weakness);

        if (!replacementCheck.replace) {
          // Preserve incumbent
          const gate = buildComplianceGate(incumbent, slot, isVerticalDrama, projectFormat, projectLane, candidates);
          return {
            slotKey: slot.key,
            winner: incumbentScored,
            allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
            noWinnerReason: null,
            complianceGate: gate,
            incumbentPreserved: true,
            incumbentReplaced: false,
            incumbentId: incumbent.id,
          };
        }
        // Fall through to replace with topCandidate
      } else {
        // Top candidate IS the incumbent — preserve
        const gate = buildComplianceGate(incumbent, slot, isVerticalDrama, projectFormat, projectLane, candidates);
        return {
          slotKey: slot.key,
          winner: incumbentScored,
          allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
          noWinnerReason: null,
          complianceGate: gate,
          incumbentPreserved: true,
          incumbentReplaced: false,
          incumbentId: incumbent.id,
        };
      }
    }
    // Incumbent not in eligible pool or not eligible — fall through to select top challenger
  }

  const winner = topCandidate;

  // ── Final compliance gate before confirming winner ──
  const gate = buildComplianceGate(
    candidates.find(c => c.id === winner.imageId) || null,
    slot, isVerticalDrama, projectFormat, projectLane, candidates,
  );

  if (gate && !gate.allowed) {
    return {
      slotKey: slot.key,
      winner: null,
      allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
      noWinnerReason: `Winner blocked by compliance gate: ${gate.reason}`,
      complianceGate: gate,
      incumbentPreserved: false,
      incumbentReplaced: false,
      incumbentId: incumbent?.id || null,
    };
  }

  return {
    slotKey: slot.key,
    winner,
    allScored: scored.sort((a, b) => b.totalScore - a.totalScore),
    noWinnerReason: null,
    complianceGate: gate,
    incumbentPreserved: false,
    incumbentReplaced: incumbent ? winner.imageId !== incumbent.id : false,
    incumbentId: incumbent?.id || null,
  };
}

function buildComplianceGate(
  image: ProjectImage | null,
  slot: SlotTarget,
  isVerticalDrama: boolean,
  projectFormat: string,
  projectLane: string,
  _candidates: ProjectImage[],
): { allowed: boolean; reason: string } | null {
  if (!image || !isVerticalDrama) return null;
  const gateResult = complianceGateForAttachment(image, slot.shotType, projectFormat, projectLane);
  return { allowed: gateResult.allowed, reason: gateResult.reason };
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
  options?: {
    mode?: RebuildMode;
    anchors?: AlignmentAnchor[];
    incumbentsBySlotKey?: Map<string, ProjectImage | null>;
  },
): SlotWinnerResult[] {
  return slots.map(slot => {
    const candidates = imagesBySlotKey.get(slot.key) || [];
    const incumbent = options?.incumbentsBySlotKey?.get(slot.key) || null;
    return selectSlotWinner(candidates, slot, isVerticalDrama, projectFormat, projectLane, {
      mode: options?.mode,
      anchors: options?.anchors,
      incumbent,
    });
  });
}

/**
 * Build a structured RebuildResult from slot results.
 */
export function buildRebuildResult(
  mode: RebuildMode,
  slotResults: SlotWinnerResult[],
  generatedCount: number,
): RebuildResult {
  const resolved = slotResults.filter(r => r.winner !== null);
  const unresolved = slotResults.filter(r => r.winner === null);
  const gateBlocked = slotResults.filter(r => r.complianceGate && !r.complianceGate.allowed);

  return {
    mode,
    totalSlots: slotResults.length,
    resolvedSlots: resolved.length - gateBlocked.length,
    unresolvedSlots: unresolved.length + gateBlocked.length,
    generatedCount,
    compliantCount: slotResults.filter(r => r.allScored.some(s => s.eligibleForSelection)).length,
    rejectedNonCompliantCount: slotResults.filter(r =>
      r.allScored.length > 0 && !r.allScored.some(s => s.eligibleForSelection)
    ).length,
    attachedWinnerCount: resolved.length - gateBlocked.length,
    preservedPrimaryCount: slotResults.filter(r => r.incumbentPreserved).length,
    replacedPrimaryCount: slotResults.filter(r => r.incumbentReplaced).length,
    winnerIds: resolved
      .filter(r => !r.complianceGate || r.complianceGate.allowed)
      .map(r => r.winner!.imageId),
    unresolvedReasons: [
      ...unresolved.map(r => ({ slotKey: r.slotKey, reason: r.noWinnerReason || 'Unknown' })),
      ...gateBlocked.map(r => ({ slotKey: r.slotKey, reason: `Gate blocked: ${r.complianceGate?.reason || 'Unknown'}` })),
    ],
  };
}
