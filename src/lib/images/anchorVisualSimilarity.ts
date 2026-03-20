/**
 * Anchor Visual Similarity — canonical types and invocation helper
 * for comparing character candidates against identity anchors using
 * AI vision-based similarity scoring.
 *
 * This is a NEW scoring dimension layered on top of existing metadata-based
 * continuity classification. It does NOT replace classifyIdentityContinuity().
 *
 * Includes DB-backed caching: results are persisted in visual_similarity_cache
 * and reused when the same candidate + anchor set + scoring version is queried.
 */

import { supabase } from '@/integrations/supabase/client';
import type { IdentityAnchorSet } from './characterIdentityAnchorSet';

// ── Constants ──

/** Bump this when the scoring prompt or model changes to auto-invalidate cache */
export const SCORING_VERSION = 'v1';

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

// ── Cache key computation ──

/**
 * Build a deterministic anchor hash from anchor image IDs.
 * Sorted alphabetically so order doesn't matter.
 */
export function computeAnchorHash(anchorSet: IdentityAnchorSet): string {
  const ids: string[] = [];
  if (anchorSet.headshot?.id) ids.push(`h:${anchorSet.headshot.id}`);
  if (anchorSet.profile?.id) ids.push(`p:${anchorSet.profile.id}`);
  if (anchorSet.fullBody?.id) ids.push(`f:${anchorSet.fullBody.id}`);
  ids.sort();
  return ids.join('|') || 'none';
}

/**
 * Extract anchor image IDs from anchor set for persistence.
 */
function extractAnchorImageIds(anchorSet: IdentityAnchorSet): string[] {
  const ids: string[] = [];
  if (anchorSet.headshot?.id) ids.push(anchorSet.headshot.id);
  if (anchorSet.profile?.id) ids.push(anchorSet.profile.id);
  if (anchorSet.fullBody?.id) ids.push(anchorSet.fullBody.id);
  return ids;
}

// ── Cache read/write ──

interface CachedSimilarity {
  dimensions_json: Record<string, SimilarityDimension>;
  composite_score: number;
  is_actionable: boolean;
  anchor_context: string;
  summary: string;
}

/**
 * Look up a cached similarity result.
 * Returns null if no valid cache exists.
 */
async function readCachedSimilarity(
  candidateImageId: string,
  anchorHash: string,
): Promise<VisualSimilarityResult | null> {
  try {
    const { data, error } = await (supabase as any)
      .from('visual_similarity_cache')
      .select('dimensions_json, composite_score, is_actionable, anchor_context, summary')
      .eq('candidate_image_id', candidateImageId)
      .eq('anchor_hash', anchorHash)
      .eq('scoring_version', SCORING_VERSION)
      .maybeSingle();

    if (error || !data) return null;

    const cached = data as CachedSimilarity;
    const dims = cached.dimensions_json as any;
    if (!dims?.face || !dims?.hair || !dims?.age || !dims?.body || !dims?.overall) return null;

    return {
      dimensions: dims,
      anchorContext: (cached.anchor_context || 'no_anchors') as VisualSimilarityResult['anchorContext'],
      summary: cached.summary || 'Cached similarity result',
      compositeScore: cached.composite_score ?? 50,
      isActionable: cached.is_actionable ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Write a similarity result to the cache.
 * Uses upsert on the unique cache key.
 */
async function writeCachedSimilarity(
  projectId: string,
  candidateImageId: string,
  characterName: string,
  anchorSet: IdentityAnchorSet,
  anchorHash: string,
  result: VisualSimilarityResult,
): Promise<void> {
  try {
    await (supabase as any)
      .from('visual_similarity_cache')
      .upsert({
        project_id: projectId,
        candidate_image_id: candidateImageId,
        character_name: characterName,
        anchor_hash: anchorHash,
        anchor_context: result.anchorContext,
        anchor_image_ids: extractAnchorImageIds(anchorSet),
        scoring_version: SCORING_VERSION,
        dimensions_json: result.dimensions,
        composite_score: result.compositeScore,
        is_actionable: result.isActionable,
        summary: result.summary,
      }, {
        onConflict: 'candidate_image_id,anchor_hash,scoring_version',
      });
  } catch (err) {
    console.warn('[anchorVisualSimilarity] Cache write failed:', err);
  }
}

// ── Edge function invocation ──

/**
 * Evaluate visual similarity between a candidate image and identity anchors.
 * Uses DB cache: reads before compute, writes after compute.
 *
 * @param candidateSignedUrl - Signed URL for the candidate image
 * @param anchorSet - Identity anchor set for the character
 * @param characterName - Character name for context
 * @param options.candidateImageId - DB image ID for cache keying
 * @param options.projectId - Project ID for cache persistence
 * @param options.skipCache - Force recomputation (default false)
 */
export async function evaluateVisualSimilarity(
  candidateSignedUrl: string,
  anchorSet: IdentityAnchorSet,
  characterName: string,
  options?: {
    candidateImageId?: string;
    projectId?: string;
    skipCache?: boolean;
  },
): Promise<VisualSimilarityResult> {
  if (!candidateSignedUrl) return NEUTRAL_SIMILARITY;
  if (anchorSet.completeness === 'no_anchors') return NEUTRAL_SIMILARITY;

  // Build anchor URLs — we need signed URLs for the anchor images
  const anchorUrls: Record<string, string> = {};
  if (anchorSet.headshot?.signedUrl) anchorUrls.headshot = anchorSet.headshot.signedUrl;
  if (anchorSet.profile?.signedUrl) anchorUrls.profile = anchorSet.profile.signedUrl;
  if (anchorSet.fullBody?.signedUrl) anchorUrls.fullBody = anchorSet.fullBody.signedUrl;

  if (Object.keys(anchorUrls).length === 0) return NEUTRAL_SIMILARITY;

  const anchorHash = computeAnchorHash(anchorSet);
  const candidateImageId = options?.candidateImageId;
  const projectId = options?.projectId;
  const skipCache = options?.skipCache ?? false;

  // ── Read from cache ──
  if (!skipCache && candidateImageId) {
    const cached = await readCachedSimilarity(candidateImageId, anchorHash);
    if (cached) {
      console.debug('[anchorVisualSimilarity] Cache hit for', candidateImageId);
      return cached;
    }
  }

  // ── Compute via edge function ──
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

    const result: VisualSimilarityResult = {
      dimensions: data.dimensions,
      anchorContext: data.anchorContext || 'no_anchors',
      summary: data.summary || 'Visual similarity evaluated',
      compositeScore,
      isActionable,
    };

    // ── Write to cache ──
    if (candidateImageId && projectId) {
      writeCachedSimilarity(projectId, candidateImageId, characterName, anchorSet, anchorHash, result);
    }

    return result;
  } catch (err) {
    console.warn('[anchorVisualSimilarity] Invocation failed:', err);
    return NEUTRAL_SIMILARITY;
  }
}

// ── Batch cache read for UI surfaces ──

/**
 * Load cached similarity results for multiple candidate image IDs at once.
 * Returns a map of imageId -> VisualSimilarityResult for cache hits.
 * Missing entries are simply absent from the map.
 */
export async function loadCachedSimilarities(
  projectId: string,
  candidateImageIds: string[],
  anchorHash: string,
): Promise<Record<string, VisualSimilarityResult>> {
  if (!candidateImageIds.length) return {};

  try {
    const { data, error } = await (supabase as any)
      .from('visual_similarity_cache')
      .select('candidate_image_id, dimensions_json, composite_score, is_actionable, anchor_context, summary')
      .eq('project_id', projectId)
      .eq('anchor_hash', anchorHash)
      .eq('scoring_version', SCORING_VERSION)
      .in('candidate_image_id', candidateImageIds);

    if (error || !data) return {};

    const result: Record<string, VisualSimilarityResult> = {};
    for (const row of data) {
      const dims = row.dimensions_json as any;
      if (!dims?.face) continue;
      result[row.candidate_image_id] = {
        dimensions: dims,
        anchorContext: (row.anchor_context || 'no_anchors') as VisualSimilarityResult['anchorContext'],
        summary: row.summary || '',
        compositeScore: row.composite_score ?? 50,
        isActionable: row.is_actionable ?? false,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Invalidate cached similarities for a character when anchors change.
 * Deletes all cache entries for the given project + character name.
 */
export async function invalidateSimilarityCache(
  projectId: string,
  characterName: string,
): Promise<void> {
  try {
    await (supabase as any)
      .from('visual_similarity_cache')
      .delete()
      .eq('project_id', projectId)
      .eq('character_name', characterName);
  } catch (err) {
    console.warn('[anchorVisualSimilarity] Cache invalidation failed:', err);
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
