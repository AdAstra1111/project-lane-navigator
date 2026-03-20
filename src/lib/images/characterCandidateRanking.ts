/**
 * Canonical Character Candidate Ranking — single source of truth
 * for "which character candidate is best" across all surfaces.
 *
 * Used by: requiredVisualSet, ApprovalWorkspace, ImageComparisonView.
 * Do not duplicate ranking logic elsewhere.
 */

import type { ProjectImage } from './types';
import {
  classifyIdentityContinuity,
  computeIdentityDriftPenalty,
  type IdentityAnchorSet,
  type IdentityContinuityStatus,
} from './characterIdentityAnchorSet';

// ── Types ──

export interface RankedCandidate {
  image: ProjectImage;
  continuityStatus: IdentityContinuityStatus;
  continuityReason: string;
  driftPenalty: number;
  score: number | null;
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
 * Ranking factors (in priority order):
 * 1. Identity continuity status
 * 2. Drift penalty
 * 3. External score (if available)
 * 4. Recency tiebreak
 *
 * This is THE ranking function. All surfaces must use it.
 */
export function rankCharacterCandidates(
  candidates: ProjectImage[],
  anchorSet: IdentityAnchorSet | null,
  scores?: Record<string, number> | null,
): RankingResult {
  if (candidates.length === 0) {
    return { ranked: [], top: null, topReason: 'No candidates available' };
  }

  const ranked: RankedCandidate[] = candidates.map(image => {
    const continuity = classifyIdentityContinuity(image, anchorSet);
    const { penalty } = computeIdentityDriftPenalty(image, anchorSet);
    const externalScore = scores?.[image.id] ?? null;

    const continuityPoints = CONTINUITY_RANK[continuity.status] ?? 10;
    // Normalize penalty: penalty is negative (e.g. -25), convert to additive
    const penaltyPoints = penalty; // already negative or 0
    // External score contribution (normalize to 0-20 range if present)
    const scorePoints = externalScore != null ? Math.min(externalScore / 5, 20) : 0;

    const rankValue = continuityPoints + penaltyPoints + scorePoints;

    const reasons: string[] = [];
    if (continuity.status === 'strong_match') reasons.push('identity locked');
    else if (continuity.status === 'partial_match') reasons.push('partial anchor context');
    else if (continuity.status === 'identity_drift') reasons.push('identity drift detected');
    else if (continuity.status === 'no_anchor_context') reasons.push('no anchors available');
    if (penalty < 0) reasons.push(`drift penalty ${penalty}`);
    if (externalScore != null) reasons.push(`score ${externalScore}`);

    return {
      image,
      continuityStatus: continuity.status,
      continuityReason: continuity.reason,
      driftPenalty: penalty,
      score: externalScore,
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
