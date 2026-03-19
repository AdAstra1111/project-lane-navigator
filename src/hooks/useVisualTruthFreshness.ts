/**
 * useVisualTruthFreshness — Shared hooks for visual asset freshness.
 * Supports posters and all downstream visual assets via the unified contract.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  checkAssetFreshness,
  type FreshnessResult,
  type TruthSnapshot,
  type VisualAssetType,
} from '@/lib/visual-truth-dependencies';

/**
 * Check freshness of a single visual asset against current upstream truth.
 */
export function useAssetFreshness(
  projectId: string | undefined,
  assetType: VisualAssetType,
  assetId: string | undefined,
  truthSnapshot: TruthSnapshot | null | undefined,
) {
  return useQuery({
    queryKey: ['asset-freshness', projectId, assetType, assetId],
    queryFn: async (): Promise<FreshnessResult> => {
      if (!projectId || !assetId) {
        return { status: 'current', staleReasons: [], changedDependencies: [], affectedClasses: [], predatesDependencyTracking: false };
      }
      return checkAssetFreshness(projectId, assetType, assetId, truthSnapshot || null);
    },
    enabled: !!projectId && !!assetId && !!truthSnapshot,
    staleTime: 5 * 60 * 1000,
  });
}

/** @deprecated Use useAssetFreshness with assetType='poster' */
export function usePosterFreshness(
  projectId: string | undefined,
  posterId: string | undefined,
  truthSnapshot: TruthSnapshot | null | undefined,
) {
  return useAssetFreshness(projectId, 'poster', posterId, truthSnapshot);
}

/**
 * Batch freshness check for all project posters.
 */
export function useProjectPostersFreshness(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-posters-freshness', projectId],
    queryFn: async (): Promise<Record<string, FreshnessResult>> => {
      if (!projectId) return {};

      const { data: posters } = await (supabase as any)
        .from('project_posters')
        .select('id, truth_snapshot_json, freshness_status')
        .eq('project_id', projectId)
        .eq('status', 'ready');

      if (!posters?.length) return {};

      const results: Record<string, FreshnessResult> = {};

      for (const poster of posters) {
        if (poster.truth_snapshot_json) {
          results[poster.id] = await checkAssetFreshness(
            projectId, 'poster', poster.id,
            poster.truth_snapshot_json as TruthSnapshot,
          );
        } else {
          results[poster.id] = {
            status: 'stale',
            staleReasons: ['Poster predates dependency tracking — re-generate under governed truth'],
            changedDependencies: [],
            affectedClasses: [],
            predatesDependencyTracking: true,
          };
        }
      }

      return results;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Batch freshness check for project images by asset group.
 */
export function useProjectImagesFreshness(
  projectId: string | undefined,
  assetGroup?: string,
) {
  return useQuery({
    queryKey: ['project-images-freshness', projectId, assetGroup],
    queryFn: async (): Promise<Record<string, FreshnessResult>> => {
      if (!projectId) return {};

      let query = (supabase as any)
        .from('project_images')
        .select('id, truth_snapshot_json, freshness_status')
        .eq('project_id', projectId)
        .eq('is_active', true);

      if (assetGroup) query = query.eq('asset_group', assetGroup);

      const { data: images } = await query.limit(100);
      if (!images?.length) return {};

      const results: Record<string, FreshnessResult> = {};
      for (const img of images) {
        if (img.truth_snapshot_json) {
          results[img.id] = await checkAssetFreshness(
            projectId, 'image', img.id,
            img.truth_snapshot_json as TruthSnapshot,
          );
        } else {
          results[img.id] = {
            status: 'stale',
            staleReasons: ['Image predates dependency tracking'],
            changedDependencies: [],
            affectedClasses: [],
            predatesDependencyTracking: true,
          };
        }
      }
      return results;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Governed refresh: re-generate poster from current approved truth.
 * Separate from creative edit — preserves composition/template/strategy.
 */
export function useRefreshPosterFromTruth(projectId: string | undefined) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (posterId: string) => {
      if (!projectId) throw new Error('No project ID');
      const { data, error } = await supabase.functions.invoke('generate-poster', {
        body: {
          project_id: projectId,
          mode: 'refresh_poster_from_truth',
          source_poster_id: posterId,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-posters', projectId] });
      qc.invalidateQueries({ queryKey: ['project-posters-freshness', projectId] });
    },
  });
}

/** @deprecated Use useRefreshPosterFromTruth for stale refreshes. */
export function useRefreshStalePoster(projectId: string | undefined) {
  return useRefreshPosterFromTruth(projectId);
}
