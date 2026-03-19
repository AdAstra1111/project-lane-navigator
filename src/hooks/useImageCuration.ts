/**
 * useImageCuration — Manages curation state transitions for project images.
 */
import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CurationState, ProjectImage } from '@/lib/images/types';

export function useImageCuration(projectId: string) {
  const qc = useQueryClient();
  const [updating, setUpdating] = useState<string | null>(null);

  const setCurationState = useCallback(async (imageId: string, state: CurationState) => {
    if (updating) return;
    setUpdating(imageId);
    try {
      // If setting to 'active', also set is_primary + is_active for backward compat
      const updates: Record<string, unknown> = { curation_state: state };
      if (state === 'active') {
        updates.is_primary = true;
        updates.is_active = true;
      } else if (state === 'archived' || state === 'rejected') {
        updates.is_primary = false;
        updates.is_active = false;
      } else {
        updates.is_primary = false;
        updates.is_active = true;
      }

      await (supabase as any)
        .from('project_images')
        .update(updates)
        .eq('id', imageId);

      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      toast.success(`Image ${state === 'active' ? 'selected' : state}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update image');
    } finally {
      setUpdating(null);
    }
  }, [projectId, updating, qc]);

  const setActiveForSlot = useCallback(async (image: ProjectImage) => {
    if (updating) return;
    setUpdating(image.id);
    try {
      // Deactivate others in same asset_group + subject + strategy_key
      const deactivateQuery = (supabase as any)
        .from('project_images')
        .update({ curation_state: 'candidate', is_primary: false })
        .eq('project_id', projectId)
        .eq('curation_state', 'active');

      if (image.asset_group) deactivateQuery.eq('asset_group', image.asset_group);
      if (image.strategy_key) deactivateQuery.eq('strategy_key', image.strategy_key);
      if (image.subject) deactivateQuery.eq('subject', image.subject);
      if (image.shot_type) deactivateQuery.eq('shot_type', image.shot_type);

      await deactivateQuery;

      // Set this one active
      await (supabase as any)
        .from('project_images')
        .update({ curation_state: 'active', is_primary: true, is_active: true })
        .eq('id', image.id);

      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      toast.success('Image selected as active');
    } catch (e: any) {
      toast.error(e.message || 'Selection failed');
    } finally {
      setUpdating(null);
    }
  }, [projectId, updating, qc]);

  return { setCurationState, setActiveForSlot, updating };
}
