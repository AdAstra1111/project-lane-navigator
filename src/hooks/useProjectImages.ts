/**
 * useProjectImages — Shared resolver hook for the canonical image system.
 * Provides role-based image queries with signed URL hydration.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage, ProjectImageRole } from '@/lib/images/types';
import { DOCUMENT_IMAGE_MAP } from '@/lib/images/types';

const IMAGE_STALE_TIME = 20 * 60 * 1000; // 20 min (signed URLs valid for 1hr)

interface ResolveOptions {
  roles?: ProjectImageRole[];
  entityId?: string;
  activeOnly?: boolean;
  primaryOnly?: boolean;
}

/**
 * Resolve project images by role, with signed URL hydration.
 */
export function useProjectImages(
  projectId: string | undefined,
  options: ResolveOptions = {},
) {
  const { roles, entityId, activeOnly = true, primaryOnly = false } = options;

  return useQuery({
    queryKey: ['project-images', projectId, roles, entityId, activeOnly, primaryOnly],
    queryFn: async (): Promise<ProjectImage[]> => {
      if (!projectId) return [];

      let query = (supabase as any)
        .from('project_images')
        .select('*')
        .eq('project_id', projectId);

      if (activeOnly) query = query.eq('is_active', true);
      if (primaryOnly) query = query.eq('is_primary', true);
      if (roles?.length) query = query.in('role', roles);
      if (entityId) query = query.eq('entity_id', entityId);

      query = query.order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) return [];

      // Hydrate signed URLs in parallel, grouped by bucket
      const images = data as ProjectImage[];
      const bucketGroups = new Map<string, ProjectImage[]>();
      for (const img of images) {
        const bucket = img.storage_bucket || 'project-posters';
        if (!bucketGroups.has(bucket)) bucketGroups.set(bucket, []);
        bucketGroups.get(bucket)!.push(img);
      }

      await Promise.all(
        Array.from(bucketGroups.entries()).map(async ([bucket, imgs]) => {
          await Promise.all(
            imgs.map(async (img) => {
              try {
                const { data: signed } = await supabase.storage
                  .from(bucket)
                  .createSignedUrl(img.storage_path, 3600);
                img.signedUrl = signed?.signedUrl || undefined;
              } catch {
                img.signedUrl = undefined;
              }
            }),
          );
        }),
      );

      return images;
    },
    enabled: !!projectId,
    staleTime: IMAGE_STALE_TIME,
  });
}

/**
 * Resolve a single primary image for a specific role.
 * Returns the signed URL or null.
 */
export function useProjectImageByRole(
  projectId: string | undefined,
  role: ProjectImageRole,
  entityId?: string,
): { url: string | null; image: ProjectImage | null; isLoading: boolean } {
  const { data, isLoading } = useProjectImages(projectId, {
    roles: [role],
    entityId,
    activeOnly: true,
    primaryOnly: true,
  });

  const image = data?.[0] || null;
  return {
    url: image?.signedUrl || null,
    image,
    isLoading,
  };
}

/**
 * Resolve images for a document type (Look Book, Character Bible, etc.).
 * Uses DOCUMENT_IMAGE_MAP to determine which roles to fetch.
 */
export function useDocumentImages(
  projectId: string | undefined,
  documentType: string,
) {
  const { DOCUMENT_IMAGE_MAP } = require('@/lib/images/types');
  const roles = DOCUMENT_IMAGE_MAP[documentType] || [];

  return useProjectImages(projectId, { roles, activeOnly: true });
}
