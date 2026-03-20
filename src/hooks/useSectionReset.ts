/**
 * useSectionReset — Per-section deterministic reset and clean regeneration.
 * 
 * Reset Section: archives all current images in a canonical section,
 * clears primary/active flags, and stamps a reset batch ID.
 * 
 * Regenerate Clean: reset + generate fresh images for the section.
 * 
 * Uses the same SECTION_QUERY_MAP as useLookbookSectionContent
 * to ensure section boundary alignment.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { CanonicalSectionKey } from '@/hooks/useLookbookSections';

/** Maps canonical section keys to DB query filters — single source of truth */
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
  key_moments: {
    strategy_keys: ['lookbook_key_moment'],
    asset_groups: ['key_moment'],
  },
  poster_directions: {
    strategy_keys: [],
    asset_groups: ['poster'],
    fallback_roles: ['poster_primary', 'poster_variant'],
  },
};

const SECTION_SHOT_FILTER: Partial<Record<CanonicalSectionKey, string[]>> = {
  atmosphere_lighting: ['atmospheric', 'time_variant', 'lighting_ref'],
  texture_detail: ['texture_ref', 'detail', 'composition_ref', 'color_ref'],
};

export interface SectionResetResult {
  archivedCount: number;
  resetBatchId: string;
}

export function useSectionReset(projectId: string) {
  const qc = useQueryClient();
  const [resettingSection, setResettingSection] = useState<string | null>(null);
  const [regeneratingSection, setRegeneratingSection] = useState<string | null>(null);

  /**
   * Build the query filter for a section's images.
   * Returns a supabase query builder scoped to the section.
   */
  const buildSectionQuery = useCallback((sectionKey: CanonicalSectionKey) => {
    const mapping = SECTION_QUERY_MAP[sectionKey];
    const shotFilter = SECTION_SHOT_FILTER[sectionKey];

    let q = (supabase as any)
      .from('project_images')
      .select('id')
      .eq('project_id', projectId);

    // Strategy key or fallback role filter
    if (mapping.strategy_keys.length > 0) {
      q = q.in('strategy_key', mapping.strategy_keys);
    } else if (mapping.fallback_roles?.length) {
      q = q.in('role', mapping.fallback_roles);
    }

    // Asset group filter
    if (mapping.asset_groups.length > 0) {
      q = q.in('asset_group', mapping.asset_groups);
    }

    // Shot type disambiguation
    if (shotFilter?.length) {
      q = q.in('shot_type', shotFilter);
    }

    return q;
  }, [projectId]);

  /**
   * Reset Section — archives all images in a canonical section.
   * 
   * Steps:
   * 1. Generate a reset batch ID for audit trail
   * 2. Find all images matching section filters (any curation_state)
   * 3. Archive them: curation_state='archived', is_primary=false, is_active=false
   * 4. Stamp canon_reset_batch_id for traceability
   * 5. Invalidate all caches
   */
  const resetSection = useCallback(async (sectionKey: CanonicalSectionKey): Promise<SectionResetResult | null> => {
    if (resettingSection) return null;
    setResettingSection(sectionKey);

    try {
      // canon_reset_batch_id is UUID — generate a proper one
      const resetBatchId = crypto.randomUUID();

      // Find all section images (regardless of current curation state)
      const findQuery = buildSectionQuery(sectionKey);
      const { data: sectionImages, error: findError } = await findQuery;

      if (findError) {
        throw new Error(`Failed to find section images: ${findError.message}`);
      }

      const imageIds = (sectionImages || []).map((r: any) => r.id);

      if (imageIds.length === 0) {
        toast.info(`${sectionKey.replace(/_/g, ' ')} — no images to reset`);
        return { archivedCount: 0, resetBatchId };
      }

      // Archive all section images in one update
      const { error: updateError } = await (supabase as any)
        .from('project_images')
        .update({
          curation_state: 'archived',
          is_primary: false,
          is_active: false,
          canon_reset_batch_id: resetBatchId,
          archived_from_active_at: new Date().toISOString(),
          stale_reason: `section_reset:${sectionKey}`,
        })
        .in('id', imageIds);

      if (updateError) {
        throw new Error(`Failed to archive section images: ${updateError.message}`);
      }

      // Invalidate all relevant caches
      invalidateAll(sectionKey);

      console.log(`[SectionReset] ${sectionKey}: archived ${imageIds.length} images, batch=${resetBatchId}`);
      toast.success(`Reset ${sectionKey.replace(/_/g, ' ')} — ${imageIds.length} images archived`);

      return { archivedCount: imageIds.length, resetBatchId };
    } catch (e: any) {
      toast.error(e.message || `Failed to reset ${sectionKey}`);
      return null;
    } finally {
      setResettingSection(null);
    }
  }, [projectId, resettingSection, buildSectionQuery]);

  /**
   * Regenerate Clean — reset section then generate fresh images.
   * 
   * Steps:
   * 1. Reset section (archive all existing)
   * 2. Call generate-lookbook-image for the section
   * 3. New images arrive as candidates (user promotes to active)
   * 4. Invalidate all caches
   */
  const regenerateClean = useCallback(async (
    sectionKey: CanonicalSectionKey,
    options?: { count?: number },
  ) => {
    if (regeneratingSection) return;
    setRegeneratingSection(sectionKey);

    try {
      // Step 1: Reset section
      const resetResult = await resetSection(sectionKey);
      if (resetResult === null && resettingSection) {
        // Reset was blocked (already resetting)
        return;
      }

      // Step 2: Generate fresh images
      const mapping = SECTION_QUERY_MAP[sectionKey];
      const sectionParam = sectionKey === 'character_identity' ? 'character'
        : sectionKey === 'world_locations' ? 'world'
        : sectionKey === 'atmosphere_lighting' ? 'visual_language'
        : sectionKey === 'texture_detail' ? 'visual_language'
        : sectionKey === 'symbolic_motifs' ? 'key_moment'
        : 'world';

      const assetGroup = mapping.asset_groups[0] || sectionParam;

      const { data, error } = await supabase.functions.invoke('generate-lookbook-image', {
        body: {
          project_id: projectId,
          section: sectionParam,
          count: options?.count || 4,
          asset_group: assetGroup,
          pack_mode: true,
        },
      });

      if (error) throw new Error(error.message);

      const results = data?.results || [];
      const successCount = results.filter((r: any) => r.status === 'ready').length;

      // Step 3: Invalidate and report
      invalidateAll(sectionKey);

      if (successCount > 0) {
        toast.success(`Regenerated ${successCount} fresh images for ${sectionKey.replace(/_/g, ' ')}`);
      } else {
        toast.warning('Reset complete but no new images generated — check upstream prerequisites');
      }
    } catch (e: any) {
      toast.error(e.message || `Failed to regenerate ${sectionKey}`);
    } finally {
      setRegeneratingSection(null);
    }
  }, [projectId, regeneratingSection, resetSection]);

  const invalidateAll = useCallback((sectionKey?: string) => {
    qc.invalidateQueries({ queryKey: ['lookbook-section-content', projectId] });
    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
    qc.invalidateQueries({ queryKey: ['lookbook-sections', projectId] });
  }, [projectId, qc]);

  return {
    resetSection,
    regenerateClean,
    resettingSection,
    regeneratingSection,
    isResetting: !!resettingSection,
    isRegenerating: !!regeneratingSection,
  };
}
