/**
 * useVisualTruthFreshness — Hook for checking and displaying visual asset freshness.
 * Supports both refresh-from-truth and creative edit as separate governed actions.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  checkAssetFreshness,
  type FreshnessResult,
  type TruthSnapshot,
} from '@/lib/visual-truth-dependencies';

/**
 * Check freshness of a single poster against current upstream truth.
 */
export function usePosterFreshness(
  projectId: string | undefined,
  posterId: string | undefined,
  truthSnapshot: TruthSnapshot | null | undefined,
) {
  return useQuery({
    queryKey: ['poster-freshness', projectId, posterId],
    queryFn: async (): Promise<FreshnessResult> => {
      if (!projectId || !posterId) {
        return { status: 'current', staleReasons: [], changedDependencies: [], affectedClasses: [], predatesDependencyTracking: false };
      }
      return checkAssetFreshness(projectId, 'poster', posterId, truthSnapshot || null);
    },
    enabled: !!projectId && !!posterId && !!truthSnapshot,
    staleTime: 5 * 60 * 1000,
  });
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
          // Poster predates dependency tracking
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
 * Governed refresh: re-generate poster from current approved truth.
 * This is SEPARATE from creative edit — preserves composition/template/strategy.
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

/**
 * @deprecated Use useRefreshPosterFromTruth for stale refreshes.
 * Keep for backward compat — routes through edit_poster.
 */
export function useRefreshStalePoster(projectId: string | undefined) {
  return useRefreshPosterFromTruth(projectId);
}
