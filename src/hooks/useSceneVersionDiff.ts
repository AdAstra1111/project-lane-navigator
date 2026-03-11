/**
 * useSceneVersionDiff — Lazily loads a scene version pair for diff comparison.
 * Fetches the current (regenerated) version and its superseded predecessor.
 * Fail-closed: returns null fields when versions unavailable.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SceneVersionData {
  id: string;
  scene_id: string;
  version_number: number;
  content: string;
  slugline: string | null;
  metadata: Record<string, any>;
  created_at: string;
  supersedes_version_id: string | null;
}

export interface SceneVersionDiffData {
  scene_key: string;
  current: SceneVersionData;
  previous: SceneVersionData | null;
}

export function useSceneVersionDiff(projectId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SceneVersionDiffData | null>(null);

  const loadDiff = useCallback(async (sceneKey: string) => {
    if (!projectId) return;
    setLoading(true);
    setError(null);

    try {
      // Find the scene_id from scene_graph_scenes by scene_key
      const { data: sceneRow, error: sceneErr } = await (supabase as any)
        .from('scene_graph_scenes')
        .select('id')
        .eq('project_id', projectId)
        .eq('scene_key', sceneKey)
        .limit(1)
        .maybeSingle();

      if (sceneErr || !sceneRow) {
        setError('Scene not found');
        setLoading(false);
        return;
      }

      // Get the two latest versions ordered by version_number desc
      const { data: versions, error: verErr } = await (supabase as any)
        .from('scene_graph_versions')
        .select('id, scene_id, version_number, content, slugline, metadata, created_at, supersedes_version_id')
        .eq('scene_id', sceneRow.id)
        .eq('project_id', projectId)
        .order('version_number', { ascending: false })
        .limit(2);

      if (verErr || !versions?.length) {
        setError('No versions found');
        setLoading(false);
        return;
      }

      const current: SceneVersionData = versions[0];
      let previous: SceneVersionData | null = null;

      if (current.supersedes_version_id) {
        // Try to find the superseded version in our fetched set first
        previous = versions.find((v: any) => v.id === current.supersedes_version_id) ?? null;

        // If not in the two we fetched, load it explicitly
        if (!previous) {
          const { data: prevRow } = await (supabase as any)
            .from('scene_graph_versions')
            .select('id, scene_id, version_number, content, slugline, metadata, created_at, supersedes_version_id')
            .eq('id', current.supersedes_version_id)
            .maybeSingle();
          previous = prevRow ?? null;
        }
      } else if (versions.length > 1) {
        // Fallback: use the second version if no explicit supersedes link
        previous = versions[1];
      }

      setData({ scene_key: sceneKey, current, previous });
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load scene versions');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
  }, []);

  return { loadDiff, data, loading, error, clear };
}
