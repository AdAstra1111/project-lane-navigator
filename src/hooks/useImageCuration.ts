/**
 * useImageCuration — Manages curation state transitions for project images.
 * Strict separation: is_primary ≠ curation_state.
 * is_primary = single canonical reference per slot.
 * curation_state = lifecycle (active/candidate/archived/rejected).
 */
import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CurationState, ProjectImage } from '@/lib/images/types';

export function useImageCuration(projectId: string) {
  const qc = useQueryClient();
  const [updating, setUpdating] = useState<string | null>(null);

  /**
   * Set curation state (active/candidate/archived/rejected).
   * Does NOT touch is_primary — that requires explicit setPrimary call.
   */
  const setCurationState = useCallback(async (imageId: string, state: CurationState) => {
    if (updating) return;
    setUpdating(imageId);
    try {
      const updates: Record<string, unknown> = { curation_state: state };
      // is_active is backward compat: active/candidate = visible, archived/rejected = hidden
      updates.is_active = (state === 'active' || state === 'candidate');

      await (supabase as any)
        .from('project_images')
        .update(updates)
        .eq('id', imageId);

      invalidate();
      toast.success(`Image ${state === 'active' ? 'activated' : state}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update image');
    } finally {
      setUpdating(null);
    }
  }, [projectId, updating]);

  /**
   * Set an image as primary for its slot (asset_group + subject + shot_type).
   * Enforces: only ONE primary per slot.
   */
  const setPrimary = useCallback(async (image: ProjectImage) => {
    if (updating) return;
    setUpdating(image.id);
    try {
      // Unset previous primary in same slot
      // Slot = asset_group + subject + shot_type (all must match)
      // If shot_type is null, scope to asset_group + subject only
      let deactivateQuery = (supabase as any)
        .from('project_images')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('is_primary', true);

      if (image.asset_group) deactivateQuery = deactivateQuery.eq('asset_group', image.asset_group);
      if (image.subject) deactivateQuery = deactivateQuery.eq('subject', image.subject);
      if (image.shot_type) {
        deactivateQuery = deactivateQuery.eq('shot_type', image.shot_type);
      } else {
        deactivateQuery = deactivateQuery.is('shot_type', null);
      }

      await deactivateQuery;

      // Set this one as primary + active
      await (supabase as any)
        .from('project_images')
        .update({ is_primary: true, curation_state: 'active', is_active: true })
        .eq('id', image.id);

      invalidate();
      toast.success('Set as primary reference');
    } catch (e: any) {
      toast.error(e.message || 'Selection failed');
    } finally {
      setUpdating(null);
    }
  }, [projectId, updating]);

  /**
   * Legacy compat — setActiveForSlot now delegates to setPrimary.
   */
  const setActiveForSlot = setPrimary;

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
  }, [projectId, qc]);

  return { setCurationState, setPrimary, setActiveForSlot, updating };
}
