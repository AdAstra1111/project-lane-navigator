/**
 * useProjectImages — Shared resolver hook for the canonical image system.
 * Provides role-based and asset-group-based queries with signed URL hydration.
 * Supports true DB pagination via limit/offset.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ProjectImage, ProjectImageRole, AssetGroup, CurationState } from '@/lib/images/types';
import { DOCUMENT_IMAGE_MAP } from '@/lib/images/types';

const IMAGE_STALE_TIME = 20 * 60 * 1000;

interface ResolveOptions {
  roles?: ProjectImageRole[];
  entityId?: string;
  activeOnly?: boolean;
  primaryOnly?: boolean;
  assetGroup?: AssetGroup;
  subject?: string;
  curationStates?: CurationState[];
  /** DB-level limit. Default: 50 */
  limit?: number;
  /** DB-level offset for pagination. Default: 0 */
  offset?: number;
}

export interface PaginatedImages {
  images: ProjectImage[];
  /** Total matching rows (for pagination UI) */
  total: number;
  hasMore: boolean;
}

export function useProjectImages(
  projectId: string | undefined,
  options: ResolveOptions = {},
) {
  const {
    roles, entityId, activeOnly = true, primaryOnly = false,
    assetGroup, subject, curationStates,
    limit = 50, offset = 0,
  } = options;

  return useQuery({
    queryKey: ['project-images', projectId, roles, entityId, activeOnly, primaryOnly, assetGroup, subject, curationStates, limit, offset],
    queryFn: async (): Promise<ProjectImage[]> => {
      if (!projectId) return [];

      let query = (supabase as any)
        .from('project_images')
        .select('*')
        .eq('project_id', projectId);

      if (activeOnly && !curationStates) query = query.eq('is_active', true);
      if (primaryOnly) query = query.eq('is_primary', true);
      if (roles?.length) query = query.in('role', roles);
      if (entityId) query = query.eq('entity_id', entityId);
      if (assetGroup) query = query.eq('asset_group', assetGroup);
      if (subject) query = query.eq('subject', subject);
      if (curationStates?.length) query = query.in('curation_state', curationStates);

      query = query
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) return [];

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
 * Paginated version — returns total count and hasMore for load-more UX.
 */
export function usePaginatedProjectImages(
  projectId: string | undefined,
  options: ResolveOptions = {},
) {
  const {
    roles, entityId, activeOnly = true, primaryOnly = false,
    assetGroup, subject, curationStates,
    limit = 12, offset = 0,
  } = options;

  return useQuery({
    queryKey: ['project-images-paginated', projectId, roles, entityId, activeOnly, primaryOnly, assetGroup, subject, curationStates, limit, offset],
    queryFn: async (): Promise<PaginatedImages> => {
      if (!projectId) return { images: [], total: 0, hasMore: false };

      // Count query
      let countQuery = (supabase as any)
        .from('project_images')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId);

      if (activeOnly && !curationStates) countQuery = countQuery.eq('is_active', true);
      if (primaryOnly) countQuery = countQuery.eq('is_primary', true);
      if (roles?.length) countQuery = countQuery.in('role', roles);
      if (entityId) countQuery = countQuery.eq('entity_id', entityId);
      if (assetGroup) countQuery = countQuery.eq('asset_group', assetGroup);
      if (subject) countQuery = countQuery.eq('subject', subject);
      if (curationStates?.length) countQuery = countQuery.in('curation_state', curationStates);

      const { count: total } = await countQuery;

      // Data query
      let query = (supabase as any)
        .from('project_images')
        .select('*')
        .eq('project_id', projectId);

      if (activeOnly && !curationStates) query = query.eq('is_active', true);
      if (primaryOnly) query = query.eq('is_primary', true);
      if (roles?.length) query = query.in('role', roles);
      if (entityId) query = query.eq('entity_id', entityId);
      if (assetGroup) query = query.eq('asset_group', assetGroup);
      if (subject) query = query.eq('subject', subject);
      if (curationStates?.length) query = query.in('curation_state', curationStates);

      query = query
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;
      if (error) throw error;

      const images = (data || []) as ProjectImage[];

      // Hydrate signed URLs
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

      return {
        images,
        total: total || 0,
        hasMore: (offset + limit) < (total || 0),
      };
    },
    enabled: !!projectId,
    staleTime: IMAGE_STALE_TIME,
  });
}

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
  return { url: image?.signedUrl || null, image, isLoading };
}

export function useDocumentImages(
  projectId: string | undefined,
  documentType: string,
) {
  const roles = DOCUMENT_IMAGE_MAP[documentType] || [];
  return useProjectImages(projectId, { roles, activeOnly: true });
}

/**
 * Query images by asset group for the Visual Asset System.
 */
export function useAssetGroupImages(
  projectId: string | undefined,
  assetGroup: AssetGroup,
  subject?: string,
) {
  return useProjectImages(projectId, {
    assetGroup,
    subject,
    activeOnly: false,
    curationStates: ['active', 'candidate'],
  });
}
