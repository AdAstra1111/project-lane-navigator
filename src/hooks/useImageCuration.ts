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
      // When demoting away from active, also clear is_primary
      if (state !== 'active') {
        updates.is_primary = false;
      }

      await (supabase as any)
        .from('project_images')
        .update(updates)
        .eq('id', imageId);

      invalidate();
      const label = state === 'active' ? 'activated' : state === 'candidate' ? 'moved to candidates' : state;
      toast.success(`Image ${label}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update image');
    } finally {
      setUpdating(null);
    }
  }, [projectId, updating]);

  /**
   * Set an image as primary for its slot.
   * Slot = asset_group + subject + shot_type + generation_purpose.
   * Identity and reference primaries are fully independent.
   * Enforces: only ONE primary per slot.
   */
  const setPrimary = useCallback(async (image: ProjectImage) => {
    if (updating) return;
    setUpdating(image.id);
    try {
      const isIdentitySlot = ['identity_headshot', 'identity_profile', 'identity_full_body']
        .includes(image.shot_type || '');

      // Unset previous primary in same slot
      let deactivateQuery = (supabase as any)
        .from('project_images')
        .update({ is_primary: false })
        .eq('project_id', projectId)
        .eq('is_primary', true);

      if (image.asset_group) deactivateQuery = deactivateQuery.eq('asset_group', image.asset_group);
      if (image.subject) deactivateQuery = deactivateQuery.eq('subject', image.subject);

      // Shot type scoping
      if (image.shot_type) {
        deactivateQuery = deactivateQuery.eq('shot_type', image.shot_type);
      } else {
        deactivateQuery = deactivateQuery.is('shot_type', null);
      }

      // IEL: generation_purpose scoping — identity vs reference primaries are independent
      if (image.generation_purpose) {
        deactivateQuery = deactivateQuery.eq('generation_purpose', image.generation_purpose);
      } else {
        deactivateQuery = deactivateQuery.is('generation_purpose', null);
      }

      await deactivateQuery;

      // For identity slots: demote all other images in this slot to candidate
      if (isIdentitySlot && image.subject && image.shot_type) {
        await (supabase as any)
          .from('project_images')
          .update({ curation_state: 'candidate', is_active: false })
          .eq('project_id', projectId)
          .eq('asset_group', 'character')
          .eq('subject', image.subject)
          .eq('shot_type', image.shot_type)
          .neq('id', image.id);
      }

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
