/**
 * useVisualSimilarityCache — Batch-load cached visual similarity results
 * for a set of candidate images against a character's identity anchors.
 *
 * Returns a Record<imageId, VisualSimilarityResult> that can be passed
 * directly into rankCharacterCandidates() and UI surfaces.
 *
 * Cache-miss policy: missing entries are neutral (absent from map).
 * No ad hoc recomputation is triggered — compute is explicit via evaluateVisualSimilarity().
 */
import { useEffect, useState, useRef } from 'react';
import {
  loadCachedSimilarities,
  computeAnchorHash,
  type VisualSimilarityResult,
} from '@/lib/images/anchorVisualSimilarity';
import type { IdentityAnchorMap } from '@/lib/images/characterIdentityAnchorSet';
import type { ProjectImage } from '@/lib/images/types';

export interface CachedSimilarityMap {
  /** imageId -> VisualSimilarityResult for cache hits */
  similarities: Record<string, VisualSimilarityResult>;
  loading: boolean;
}

/**
 * Batch-load cached visual similarities for all character candidates
 * using the identity anchor map.
 */
export function useVisualSimilarityCache(
  projectId: string | undefined,
  candidates: ProjectImage[],
  identityAnchorMap: IdentityAnchorMap | undefined,
): CachedSimilarityMap {
  const [similarities, setSimilarities] = useState<Record<string, VisualSimilarityResult>>({});
  const [loading, setLoading] = useState(false);
  const lastKeyRef = useRef('');

  useEffect(() => {
    if (!projectId || !identityAnchorMap || candidates.length === 0) {
      setSimilarities({});
      return;
    }

    // Group candidates by character name for per-anchor-hash lookup
    const charGroups: Record<string, { anchorHash: string; imageIds: string[] }> = {};

    for (const img of candidates) {
      if (img.asset_group !== 'character' || !img.subject) continue;
      const anchors = identityAnchorMap[img.subject];
      if (!anchors || anchors.completeness === 'no_anchors') continue;

      const hash = computeAnchorHash(anchors);
      if (!charGroups[hash]) {
        charGroups[hash] = { anchorHash: hash, imageIds: [] };
      }
      charGroups[hash].imageIds.push(img.id);
    }

    const groups = Object.values(charGroups);
    if (groups.length === 0) {
      setSimilarities({});
      return;
    }

    // Dedupe: skip if inputs haven't changed
    const cacheKey = groups.map(g => `${g.anchorHash}:${g.imageIds.sort().join(',')}`).sort().join('|');
    if (cacheKey === lastKeyRef.current) return;
    lastKeyRef.current = cacheKey;

    let cancelled = false;
    setLoading(true);

    Promise.all(
      groups.map(g => loadCachedSimilarities(projectId, g.imageIds, g.anchorHash)),
    ).then(results => {
      if (cancelled) return;
      const merged: Record<string, VisualSimilarityResult> = {};
      for (const r of results) {
        Object.assign(merged, r);
      }
      setSimilarities(merged);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) {
        setSimilarities({});
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [projectId, candidates, identityAnchorMap]);

  return { similarities, loading };
}
