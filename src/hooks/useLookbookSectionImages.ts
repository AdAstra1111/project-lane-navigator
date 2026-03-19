/**
 * useLookbookSectionImages — Fetches and generates image packs for Look Book sections.
 * Now supports full pack generation with shot taxonomy.
 */
import { useCallback, useState } from 'react';
import { useProjectImages } from './useProjectImages';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImageRole, AssetGroup } from '@/lib/images/types';

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

export function useLookbookSectionImages(projectId: string | undefined, section: LookbookSection, entityId?: string) {
  const role = SECTION_ROLE_MAP[section];
  const strategyKey = SECTION_STRATEGY_MAP[section];
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  const { data: allImages = [], isLoading } = useProjectImages(projectId, {
    roles: [role],
    activeOnly: false,
  });

  const sectionImages = allImages.filter(img => img.strategy_key === strategyKey && (!entityId || img.entity_id === entityId));
  const activeImage = sectionImages.find(img => img.is_primary) || sectionImages[0] || null;

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
        qc.invalidateQueries({ queryKey: ['project-images', projectId] });
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
  };
}
