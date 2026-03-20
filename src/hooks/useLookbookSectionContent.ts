/**
 * useLookbookSectionContent — Maps canonical lookbook section keys
 * to image retrieval logic and upstream blocker resolution.
 * Replaces legacy IMAGE_SECTIONS as the authoritative section→image binding.
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectImage, CurationState } from '@/lib/images/types';
import type { CanonicalSectionKey } from '@/hooks/useLookbookSections';

/** Maps canonical section keys to DB query filters */
const SECTION_QUERY_MAP: Record<CanonicalSectionKey, {
  strategy_keys: string[];
  asset_groups: string[];
  fallback_roles?: string[];
}> = {
  character_identity: {
    strategy_keys: ['lookbook_character'],
    asset_groups: ['character'],
    fallback_roles: ['character_primary', 'character_variant'],
  },
  world_locations: {
    strategy_keys: ['lookbook_world'],
    asset_groups: ['world'],
    fallback_roles: ['world_establishing', 'world_detail'],
  },
  atmosphere_lighting: {
    strategy_keys: ['lookbook_visual_language'],
    asset_groups: ['visual_language'],
  },
  texture_detail: {
    strategy_keys: ['lookbook_visual_language'],
    asset_groups: ['visual_language'],
  },
  symbolic_motifs: {
    strategy_keys: ['lookbook_key_moment'],
    asset_groups: ['key_moment'],
  },
  poster_directions: {
    strategy_keys: [],
    asset_groups: ['poster'],
    fallback_roles: ['poster_primary', 'poster_variant'],
  },
};

/** Shot type filters for disambiguation of shared asset_groups */
const SECTION_SHOT_FILTER: Partial<Record<CanonicalSectionKey, string[]>> = {
  atmosphere_lighting: ['atmospheric', 'time_variant', 'lighting_ref'],
  texture_detail: ['texture_ref', 'detail', 'composition_ref', 'color_ref'],
};

const IMAGE_STALE_TIME = 20 * 60 * 1000;

export interface SectionBlocker {
  message: string;
  severity: 'hard' | 'soft';
}

export function useLookbookSectionContent(
  projectId: string | undefined,
  sectionKey: CanonicalSectionKey,
  options: { curationFilter?: CurationState | 'all' | 'working'; pageSize?: number } = {},
) {
  const qc = useQueryClient();
  const pageSize = options.pageSize || 12;
  const mapping = SECTION_QUERY_MAP[sectionKey];
  const shotFilter = SECTION_SHOT_FILTER[sectionKey];

  const curationStates: CurationState[] =
    !options.curationFilter || options.curationFilter === 'all'
      ? ['active', 'candidate', 'archived']
      : options.curationFilter === 'working'
        ? ['active', 'candidate']
        : [options.curationFilter];

  const { data, isLoading } = useQuery({
    queryKey: ['lookbook-section-content', projectId, sectionKey, curationStates, pageSize],
    queryFn: async () => {
      if (!projectId) return { images: [] as ProjectImage[], total: 0 };

      let q = (supabase as any)
        .from('project_images')
        .select('*')
        .eq('project_id', projectId);

      // Filter by strategy_keys OR fallback_roles
      if (mapping.strategy_keys.length > 0) {
        q = q.in('strategy_key', mapping.strategy_keys);
      } else if (mapping.fallback_roles?.length) {
        q = q.in('role', mapping.fallback_roles);
      }

      if (mapping.asset_groups.length > 0) {
        q = q.in('asset_group', mapping.asset_groups);
      }

      if (curationStates.length < 4) {
        q = q.in('curation_state', curationStates);
      }

      // Shot type disambiguation for sections sharing an asset_group
      if (shotFilter?.length) {
        q = q.in('shot_type', shotFilter);
      }

      q = q
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(pageSize);

      const { data: rows, error } = await q;
      if (error) throw error;

      const images = (rows || []) as ProjectImage[];

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

      return { images, total: images.length };
    },
    enabled: !!projectId,
    staleTime: IMAGE_STALE_TIME,
  });

  // Resolve upstream blockers
  const blockers = useMemo((): SectionBlocker[] => {
    if (!data) return [];
    const b: SectionBlocker[] = [];

    if (sectionKey === 'character_identity' && data.images.length === 0) {
      b.push({ message: 'No approved character identity images found. Generate or approve cast photos first.', severity: 'soft' });
    }
    if (sectionKey === 'world_locations' && data.images.length === 0) {
      b.push({ message: 'No canon-bound location references found. Build world references first.', severity: 'soft' });
    }
    if (sectionKey === 'atmosphere_lighting' && data.images.length === 0) {
      b.push({ message: 'No atmospheric or lighting references available. Generate visual language images first.', severity: 'soft' });
    }
    if (sectionKey === 'texture_detail' && data.images.length === 0) {
      b.push({ message: 'No texture or detail references available. Generate visual language images first.', severity: 'soft' });
    }
    if (sectionKey === 'symbolic_motifs' && data.images.length === 0) {
      b.push({ message: 'No symbolic motif references found. Curate key moment images or generate new ones.', severity: 'soft' });
    }
    if (sectionKey === 'poster_directions' && data.images.length === 0) {
      b.push({ message: 'No poster directions available. Generate posters in Poster Studio first.', severity: 'soft' });
    }

    return b;
  }, [data, sectionKey]);

  const invalidateSection = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['lookbook-section-content', projectId, sectionKey] });
  }, [qc, projectId, sectionKey]);

  return {
    images: data?.images || [],
    total: data?.total || 0,
    isLoading,
    blockers,
    invalidateSection,
  };
}
