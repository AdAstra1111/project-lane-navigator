/**
 * Canonical Character Candidate Ranking — single source of truth
 * for "which character candidate is best" across all surfaces.
 *
 * Used by: requiredVisualSet, ApprovalWorkspace, ImageComparisonView.
 * Do not duplicate ranking logic elsewhere.
 *
 * Ranking factors (in priority order):
 * 1. Identity continuity status (metadata-based)
 * 2. Drift penalty
 * 3. Visual similarity adjustment (AI vision, when available)
 * 4. External score (if available)
 * 5. Recency tiebreak
 */

import type { ProjectImage } from './types';
import {
  classifyIdentityContinuity,
  computeIdentityDriftPenalty,
  type IdentityAnchorSet,
  type IdentityContinuityStatus,
} from './characterIdentityAnchorSet';
import {
  computeSimilarityRankAdjustment,
  type VisualSimilarityResult,
} from './anchorVisualSimilarity';

// ── Types ──

export interface RankedCandidate {
  image: ProjectImage;
  continuityStatus: IdentityContinuityStatus;
  continuityReason: string;
  driftPenalty: number;
  score: number | null;
  /** Visual similarity result if available */
  visualSimilarity: VisualSimilarityResult | null;
  /** Adjustment from visual similarity */
  similarityAdjustment: number;
  /** Composite rank value — higher is better */
  rankValue: number;
  /** Human-readable reason for this candidate's ranking position */
  rankReason: string;
}

export interface RankingResult {
  ranked: RankedCandidate[];
  top: RankedCandidate | null;
  /** Why the top candidate was chosen */
  topReason: string;
}

// ── Continuity rank values (deterministic) ──

const CONTINUITY_RANK: Record<IdentityContinuityStatus, number> = {
  strong_match: 40,
  partial_match: 30,
  no_anchor_context: 20,
  unknown: 10,
  identity_drift: 0,
};

// ── Canonical ranking function ──

/**
 * Rank character candidates using canonical identity-aware logic.
 *
 * This is THE ranking function. All surfaces must use it.
 */
export function rankCharacterCandidates(
  candidates: ProjectImage[],
  anchorSet: IdentityAnchorSet | null,
  scores?: Record<string, number> | null,
  /** Optional per-image visual similarity results from AI vision comparison */
  visualSimilarities?: Record<string, VisualSimilarityResult> | null,
): RankingResult {
  if (candidates.length === 0) {
    return { ranked: [], top: null, topReason: 'No candidates available' };
  }

  const ranked: RankedCandidate[] = candidates.map(image => {
    const continuity = classifyIdentityContinuity(image, anchorSet);
    const { penalty } = computeIdentityDriftPenalty(image, anchorSet);
    const externalScore = scores?.[image.id] ?? null;
    const similarity = visualSimilarities?.[image.id] ?? null;
    const { adjustment: simAdj, reason: simReason } = computeSimilarityRankAdjustment(similarity);

    const continuityPoints = CONTINUITY_RANK[continuity.status] ?? 10;
    const penaltyPoints = penalty; // already negative or 0
    const scorePoints = externalScore != null ? Math.min(externalScore / 5, 20) : 0;

    const rankValue = continuityPoints + penaltyPoints + simAdj + scorePoints;

    const reasons: string[] = [];
    if (continuity.status === 'strong_match') reasons.push('identity locked');
    else if (continuity.status === 'partial_match') reasons.push('partial anchor context');
    else if (continuity.status === 'identity_drift') reasons.push('identity drift detected');
    else if (continuity.status === 'no_anchor_context') reasons.push('no anchors available');
    if (penalty < 0) reasons.push(`drift penalty ${penalty}`);
    if (simAdj !== 0) reasons.push(simReason);
    else if (similarity?.isActionable) reasons.push(simReason);
    if (externalScore != null) reasons.push(`score ${externalScore}`);

    return {
      image,
      continuityStatus: continuity.status,
      continuityReason: continuity.reason,
      driftPenalty: penalty,
      score: externalScore,
      visualSimilarity: similarity,
      similarityAdjustment: simAdj,
      rankValue,
      rankReason: reasons.join('; ') || 'default ranking',
    };
  });

  // Sort: highest rankValue first, recency tiebreak
  ranked.sort((a, b) => {
    if (a.rankValue !== b.rankValue) return b.rankValue - a.rankValue;
    return (b.image.created_at || '').localeCompare(a.image.created_at || '');
  });

  const top = ranked[0];
  const topReason = top
    ? `Recommended: ${top.rankReason}`
    : 'No candidates available';

  return { ranked, top, topReason };
}
