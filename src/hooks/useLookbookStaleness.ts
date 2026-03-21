/**
 * useLookbookStaleness — Detects when project_images have changed
 * since the last LookBook build, without any schema changes.
 * Uses a local epoch timestamp compared against latest image created_at.
 */
import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LookbookStalenessState {
  /** Whether the LookBook is stale (images changed since last build) */
  isStale: boolean;
  /** Record the current moment as "last built" */
  markBuilt: () => void;
  /** Force a re-check */
  recheck: () => void;
}

export function useLookbookStaleness(
  projectId: string | undefined,
  buildEpoch: number,
): LookbookStalenessState {
  const [lastBuildTime, setLastBuildTime] = useState<string | null>(null);
  const [latestImageTime, setLatestImageTime] = useState<string | null>(null);

  const markBuilt = useCallback(() => {
    setLastBuildTime(new Date().toISOString());
  }, []);

  // When buildEpoch changes (a build happened), mark as built
  useEffect(() => {
    if (buildEpoch > 0) {
      setLastBuildTime(new Date().toISOString());
    }
  }, [buildEpoch]);

  const checkLatestImage = useCallback(async () => {
    if (!projectId) return;
    try {
      const { data } = await (supabase as any)
        .from('project_images')
        .select('created_at')
        .eq('project_id', projectId)
        .in('curation_state', ['active', 'candidate'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.created_at) {
        setLatestImageTime(data.created_at);
      }
    } catch {
      // silent — non-critical
    }
  }, [projectId]);

  // Check on mount and periodically
  useEffect(() => {
    checkLatestImage();
    const interval = setInterval(checkLatestImage, 30_000);
    return () => clearInterval(interval);
  }, [checkLatestImage]);

  const isStale = !!(
    lastBuildTime &&
    latestImageTime &&
    new Date(latestImageTime) > new Date(lastBuildTime)
  );

  return { isStale, markBuilt, recheck: checkLatestImage };
}
