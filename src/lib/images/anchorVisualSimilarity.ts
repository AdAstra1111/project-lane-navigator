/**
 * Anchor Visual Similarity — canonical types and invocation helper
 * for comparing character candidates against identity anchors using
 * AI vision-based similarity scoring.
 *
 * This is a NEW scoring dimension layered on top of existing metadata-based
 * continuity classification. It does NOT replace classifyIdentityContinuity().
 */

import { supabase } from '@/integrations/supabase/client';
import type { IdentityAnchorSet } from './characterIdentityAnchorSet';

// ── Types ──

export type SimilarityConfidence = 'high' | 'medium' | 'low' | 'unavailable';

export interface SimilarityDimension {
  score: number;          // 0-100
  confidence: SimilarityConfidence;
  reason: string;
}

export interface VisualSimilarityResult {
  dimensions: {
    face: SimilarityDimension;
    hair: SimilarityDimension;
    age: SimilarityDimension;
    body: SimilarityDimension;
    overall: SimilarityDimension;
  };
  anchorContext: 'full_lock' | 'partial_lock' | 'single_anchor' | 'no_anchors';
  summary: string;
  /** Composite score for ranking integration (0-100) */
  compositeScore: number;
  /** Whether this result is usable for ranking adjustments */
  isActionable: boolean;
}

// ── Neutral result for when similarity cannot be computed ──

const NEUTRAL_DIM: SimilarityDimension = {
  score: 50, confidence: 'unavailable', reason: 'Not assessed',
};

export const NEUTRAL_SIMILARITY: VisualSimilarityResult = {
  dimensions: {
    face: NEUTRAL_DIM, hair: NEUTRAL_DIM, age: NEUTRAL_DIM,
    body: NEUTRAL_DIM, overall: NEUTRAL_DIM,
  },
  anchorContext: 'no_anchors',
  summary: 'Visual similarity not available',
  compositeScore: 50,
  isActionable: false,
};

// ── Composite score computation ──

const DIM_WEIGHTS = {
  face: 0.40,
  hair: 0.15,
  age: 0.20,
  body: 0.10,
  overall: 0.15,
} as const;

/**
 * Compute a weighted composite from dimension scores.
 * Only dimensions with confidence !== 'unavailable' contribute.
 * Returns 50 (neutral) if no dimensions are assessable.
 */
export function computeCompositeScore(
  dims: VisualSimilarityResult['dimensions'],
): { compositeScore: number; isActionable: boolean } {
  let weightSum = 0;
  let scoreSum = 0;

  for (const [key, weight] of Object.entries(DIM_WEIGHTS)) {
    const dim = dims[key as keyof typeof dims];
    if (dim.confidence === 'unavailable') continue;
    weightSum += weight;
    scoreSum += dim.score * weight;
  }

  if (weightSum < 0.2) {
    return { compositeScore: 50, isActionable: false };
  }

  return {
    compositeScore: Math.round(scoreSum / weightSum),
    isActionable: true,
  };
}

// ── Human-readable similarity label ──

export function getSimilarityLabel(score: number): string {
  if (score >= 80) return 'Strong match';
  if (score >= 60) return 'Moderate match';
  if (score >= 40) return 'Weak match';
  return 'Low similarity';
}

export function getSimilarityColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

// ── Edge function invocation ──

/**
 * Evaluate visual similarity between a candidate image and identity anchors.
 * Calls the evaluate-visual-similarity edge function.
 */
export async function evaluateVisualSimilarity(
  candidateSignedUrl: string,
  anchorSet: IdentityAnchorSet,
  characterName: string,
): Promise<VisualSimilarityResult> {
  if (!candidateSignedUrl) return NEUTRAL_SIMILARITY;
  if (anchorSet.completeness === 'no_anchors') return NEUTRAL_SIMILARITY;

  // Build anchor URLs — we need signed URLs for the anchor images
  const anchorUrls: Record<string, string> = {};
  if (anchorSet.headshot?.signedUrl) anchorUrls.headshot = anchorSet.headshot.signedUrl;
  if (anchorSet.profile?.signedUrl) anchorUrls.profile = anchorSet.profile.signedUrl;
  if (anchorSet.fullBody?.signedUrl) anchorUrls.fullBody = anchorSet.fullBody.signedUrl;

  if (Object.keys(anchorUrls).length === 0) return NEUTRAL_SIMILARITY;

  try {
    const { data, error } = await supabase.functions.invoke('evaluate-visual-similarity', {
      body: { candidateUrl: candidateSignedUrl, anchorUrls, characterName },
    });

    if (error) {
      console.warn('[anchorVisualSimilarity] Edge function error:', error);
      return NEUTRAL_SIMILARITY;
    }

    if (!data?.dimensions) {
      console.warn('[anchorVisualSimilarity] Invalid response shape');
      return NEUTRAL_SIMILARITY;
    }

    const { compositeScore, isActionable } = computeCompositeScore(data.dimensions);

    return {
      dimensions: data.dimensions,
      anchorContext: data.anchorContext || 'no_anchors',
      summary: data.summary || 'Visual similarity evaluated',
      compositeScore,
      isActionable,
    };
  } catch (err) {
    console.warn('[anchorVisualSimilarity] Invocation failed:', err);
    return NEUTRAL_SIMILARITY;
  }
}

// ── Ranking integration helper ──

/**
 * Compute a ranking adjustment from visual similarity.
 * Returns a value to ADD to the candidate's rankValue.
 *
 * - Strong match: +10
 * - Moderate: +3
 * - Weak: 0
 * - Low: -8
 * - Not actionable: 0 (no effect)
 */
export function computeSimilarityRankAdjustment(
  similarity: VisualSimilarityResult | null,
): { adjustment: number; reason: string } {
  if (!similarity || !similarity.isActionable) {
    return { adjustment: 0, reason: 'visual similarity not available' };
  }

  const score = similarity.compositeScore;
  if (score >= 80) return { adjustment: 10, reason: `strong visual match (${score})` };
  if (score >= 60) return { adjustment: 3, reason: `moderate visual match (${score})` };
  if (score >= 40) return { adjustment: 0, reason: `weak visual match (${score})` };
  return { adjustment: -8, reason: `low visual similarity (${score})` };
}
