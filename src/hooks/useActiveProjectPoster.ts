/**
 * useActiveProjectPoster — Lightweight shared hook that resolves a project's
 * active poster signed URL. Designed for use across dashboard cards, project
 * profile pages, and any surface that needs the project's visual identity.
 *
 * Single query per project, cached for 30min (signed URL lifetime = 1hr).
 * Returns null gracefully when no poster exists.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ActivePosterResult {
  /** Signed URL for display — key art or rendered poster */
  url: string | null;
  /** Poster record ID */
  posterId: string | null;
  /** Whether the poster is rendered (composed) or raw key art */
  renderStatus: 'key_art_only' | 'composed_preview' | 'composed_final' | null;
}

const EMPTY: ActivePosterResult = { url: null, posterId: null, renderStatus: null };

/**
 * Resolve the active poster for a project. Lightweight — single row fetch + signed URL.
 */
export function useActiveProjectPoster(projectId: string | undefined): {
  data: ActivePosterResult;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['active-project-poster', projectId],
    queryFn: async (): Promise<ActivePosterResult> => {
      if (!projectId) return EMPTY;

      // Fetch only the active poster (single row)
      const { data: poster, error } = await (supabase as any)
        .from('project_posters')
        .select('id, key_art_storage_path, rendered_storage_path, render_status')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .eq('status', 'ready')
        .limit(1)
        .maybeSingle();

      if (error || !poster) return EMPTY;

      // Prefer rendered poster, fall back to key art
      const storagePath = poster.rendered_storage_path || poster.key_art_storage_path;
      if (!storagePath) return EMPTY;

      const { data: signed } = await supabase.storage
        .from('project-posters')
        .createSignedUrl(storagePath, 3600);

      return {
        url: signed?.signedUrl || null,
        posterId: poster.id,
        renderStatus: poster.render_status || 'key_art_only',
      };
    },
    enabled: !!projectId,
    staleTime: 30 * 60 * 1000, // 30 min — aligned with signed URL expiry
  });

  return { data: data ?? EMPTY, isLoading };
}

/**
 * Batch-resolve active posters for multiple projects.
 * Returns a Map<projectId, url>.
 * Used by dashboard/list views to avoid N+1 queries.
 */
export function useActivePostersForProjects(projectIds: string[]): {
  posterMap: Map<string, string>;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: ['active-project-posters-batch', ...projectIds.sort()],
    queryFn: async (): Promise<Map<string, string>> => {
      if (!projectIds.length) return new Map();

      const { data: posters, error } = await (supabase as any)
        .from('project_posters')
        .select('id, project_id, key_art_storage_path, rendered_storage_path')
        .in('project_id', projectIds)
        .eq('is_active', true)
        .eq('status', 'ready');

      if (error || !posters?.length) return new Map();

      // Sign all URLs in parallel
      const entries = await Promise.all(
        (posters as any[]).map(async (p) => {
          const path = p.rendered_storage_path || p.key_art_storage_path;
          if (!path) return null;
          const { data: signed } = await supabase.storage
            .from('project-posters')
            .createSignedUrl(path, 3600);
          return signed?.signedUrl ? [p.project_id as string, signed.signedUrl as string] as const : null;
        })
      );

      return new Map(entries.filter(Boolean) as [string, string][]);
    },
    enabled: projectIds.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  return { posterMap: data ?? new Map(), isLoading };
}
