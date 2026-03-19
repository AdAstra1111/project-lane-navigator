/**
 * useLookbookSectionImages — Fetches and generates image packs for Look Book sections.
 * Uses true DB pagination with strategy_key filtering at DB level.
 * Accumulates pages for append-mode load-more.
 */
import { useCallback, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ProjectImage, ProjectImageRole, AssetGroup, CurationState } from '@/lib/images/types';

type LookbookSection = 'world' | 'character' | 'key_moment' | 'visual_language';

const SECTION_ROLE_MAP: Record<LookbookSection, ProjectImageRole> = {
  world: 'world_establishing',
  character: 'character_primary',
  key_moment: 'visual_reference',
  visual_language: 'visual_reference',
};

const SECTION_STRATEGY_MAP: Record<LookbookSection, string> = {
  world: 'lookbook_world',
  character: 'lookbook_character',
  key_moment: 'lookbook_key_moment',
  visual_language: 'lookbook_visual_language',
};

const SECTION_ASSET_GROUP: Record<LookbookSection, AssetGroup> = {
  world: 'world',
  character: 'character',
  key_moment: 'key_moment',
  visual_language: 'visual_language',
};

const IMAGE_STALE_TIME = 20 * 60 * 1000;

/**
 * Section-accurate paginated query that filters by strategy_key at DB level.
 * Returns total and hasMore scoped to the exact section.
 */
function useSectionPaginatedImages(
  projectId: string | undefined,
  section: LookbookSection,
  entityId?: string,
  options: { curationStates?: CurationState[]; limit?: number; offset?: number } = {},
) {
  const role = SECTION_ROLE_MAP[section];
  const strategyKey = SECTION_STRATEGY_MAP[section];
  const assetGroup = SECTION_ASSET_GROUP[section];
  const { curationStates, limit = 12, offset = 0 } = options;

  return useQuery({
    queryKey: ['section-images', projectId, section, entityId, curationStates, limit, offset],
    queryFn: async () => {
      if (!projectId) return { images: [] as ProjectImage[], total: 0, hasMore: false };

      // Count query — section-scoped
      let countQ = (supabase as any)
        .from('project_images')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('strategy_key', strategyKey)
        .eq('asset_group', assetGroup);
      if (curationStates?.length) countQ = countQ.in('curation_state', curationStates);
      if (entityId) countQ = countQ.eq('entity_id', entityId);
      const { count: total } = await countQ;

      // Data query — section-scoped
      let q = (supabase as any)
        .from('project_images')
        .select('*')
        .eq('project_id', projectId)
        .eq('strategy_key', strategyKey)
        .eq('asset_group', assetGroup);
      if (curationStates?.length) q = q.in('curation_state', curationStates);
      if (entityId) q = q.eq('entity_id', entityId);
      q = q
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await q;
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

export function useLookbookSectionImages(
  projectId: string | undefined,
  section: LookbookSection,
  entityId?: string,
  options: { curationFilter?: CurationState | 'all'; pageSize?: number } = {},
) {
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const pageSize = options.pageSize || 12;

  // Determine curation states for query
  const curationStates: CurationState[] =
    !options.curationFilter || options.curationFilter === 'all'
      ? ['active', 'candidate', 'archived']
      : [options.curationFilter];

  // Fetch all loaded pages and accumulate
  // We query for pageCount * pageSize items starting from offset 0
  // This ensures append behavior — new pages add to existing results
  const totalLimit = pageCount * pageSize;

  const { data: paginated, isLoading } = useSectionPaginatedImages(projectId, section, entityId, {
    curationStates,
    limit: totalLimit,
    offset: 0,
  });

  const sectionImages = paginated?.images || [];
  const activeImage = sectionImages.find(img => img.is_primary) || sectionImages[0] || null;
  const total = paginated?.total || 0;
  const hasMore = sectionImages.length < total;

  const loadMore = useCallback(() => {
    setPageCount(prev => prev + 1);
  }, []);

  const resetPagination = useCallback(() => {
    setPageCount(1);
  }, []);

  const generate = useCallback(async (count = 4, characterName?: string) => {
    if (!projectId || generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section,
          count,
          entity_id: entityId,
          character_name: characterName,
          asset_group: SECTION_ASSET_GROUP[section],
          pack_mode: true,
        },
      });
      if (error) throw error;
      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;
      if (successCount > 0) {
        toast.success(`Generated ${successCount} ${section} image${successCount > 1 ? 's' : ''}`);
        qc.invalidateQueries({ queryKey: ['section-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
        qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      } else {
        toast.error('No images were generated successfully');
      }
    } catch (e: any) {
      toast.error(e.message || `Failed to generate ${section} images`);
    } finally {
      setGenerating(false);
    }
  }, [projectId, section, entityId, generating, qc]);

  return {
    sectionImages,
    activeImage,
    isLoading,
    generating,
    generate,
    total,
    hasMore,
    loadMore,
    resetPagination,
  };
}
