/**
 * useSceneSluglines — read-only hook mapping scene_id → slugline.
 * Queries scene_graph_versions for the latest slugline per scene.
 * Fail-closed: returns empty map when unavailable.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type SluglineMap = Map<string, string>;

export function useSceneSluglines(projectId: string | undefined) {
  return useQuery<SluglineMap>({
    queryKey: ['scene-sluglines', projectId],
    queryFn: async () => {
      if (!projectId) return new Map();

      const { data, error } = await (supabase as any)
        .from('scene_graph_versions')
        .select('scene_id, slugline, version_number')
        .eq('project_id', projectId)
        .not('slugline', 'is', null)
        .order('version_number', { ascending: false });

      if (error || !data) return new Map();

      // Keep only the latest version's slugline per scene_id
      const map = new Map<string, string>();
      for (const row of data as { scene_id: string; slugline: string | null; version_number: number }[]) {
        if (row.slugline && !map.has(row.scene_id)) {
          map.set(row.scene_id, row.slugline);
        }
      }
      return map;
    },
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}
