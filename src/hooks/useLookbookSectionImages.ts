/**
 * useLookbookSectionImages — Fetches and generates images for Look Book sections.
 */
import { useCallback, useState } from 'react';
import { useProjectImages } from './useProjectImages';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImageRole } from '@/lib/images/types';

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

export function useLookbookSectionImages(projectId: string | undefined, section: LookbookSection, entityId?: string) {
  const role = SECTION_ROLE_MAP[section];
  const strategyKey = SECTION_STRATEGY_MAP[section];
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);

  // Fetch all images for this section (by role + strategy)
  const { data: allImages = [], isLoading } = useProjectImages(projectId, {
    roles: [role],
    activeOnly: false,
  });

  // Filter to this section's strategy
  const sectionImages = allImages.filter(img => img.strategy_key === strategyKey && (!entityId || img.entity_id === entityId));

  // Get the currently selected (primary) image
  const activeImage = sectionImages.find(img => img.is_primary) || sectionImages[0] || null;

  const generate = useCallback(async (count = 3, characterName?: string) => {
    if (!projectId || generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: { project_id: projectId, section, count, entity_id: entityId, character_name: characterName },
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
