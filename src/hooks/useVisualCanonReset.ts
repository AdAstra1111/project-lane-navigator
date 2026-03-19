/**
 * useVisualCanonReset — Deterministic Visual Canon Reset + Rebuild workflow.
 *
 * Reset: Bulk archives all active/primary images for a project without deleting.
 * Rebuild: Uses RequiredVisualSetResolver to show what needs to be filled.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, CurationState } from '@/lib/images/types';

export interface CanonResetResult {
  batchId: string;
  archivedCount: number;
  timestamp: string;
}

export function useVisualCanonReset(projectId: string) {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const [lastReset, setLastReset] = useState<CanonResetResult | null>(null);

  /**
   * Execute a full visual canon reset.
   * - Sets all active/candidate images to archived
   * - Clears is_primary on all images
   * - Records archived_from_active_at timestamp
   * - Groups under a shared canon_reset_batch_id
   * - Does NOT delete any images
   */
  const resetActiveCanon = useCallback(async (): Promise<CanonResetResult | null> => {
    if (resetting) return null;
    setResetting(true);

    try {
      const batchId = crypto.randomUUID();
      const now = new Date().toISOString();

      // Step 1: Archive all active/candidate images and clear primaries
      const { data: affected, error } = await (supabase as any)
        .from('project_images')
        .update({
          curation_state: 'archived' as CurationState,
          is_active: false,
          is_primary: false,
          archived_from_active_at: now,
          canon_reset_batch_id: batchId,
        })
        .eq('project_id', projectId)
        .in('curation_state', ['active', 'candidate'])
        .select('id');

      if (error) throw error;

      const archivedCount = affected?.length || 0;

      const result: CanonResetResult = {
        batchId,
        archivedCount,
        timestamp: now,
      };

      setLastReset(result);

      // Invalidate all image queries
      qc.invalidateQueries({ queryKey: ['project-images', projectId] });
      qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
      qc.invalidateQueries({ queryKey: ['section-images', projectId] });

      toast.success(`Visual canon reset: ${archivedCount} images archived. No images deleted.`);
      return result;
    } catch (e: any) {
      toast.error(e.message || 'Failed to reset visual canon');
      return null;
    } finally {
      setResetting(false);
    }
  }, [projectId, resetting, qc]);

  /**
   * Restore a specific image from archived to candidate state.
   */
  const restoreFromArchive = useCallback(async (imageId: string) => {
    await (supabase as any)
      .from('project_images')
      .update({
        curation_state: 'candidate' as CurationState,
        is_active: true,
        archived_from_active_at: null,
      })
      .eq('id', imageId);

    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
    toast.success('Image restored as candidate');
  }, [projectId, qc]);

  /**
   * Mark an image as reuse-pool eligible.
   */
  const markForReusePool = useCallback(async (imageId: string) => {
    await (supabase as any)
      .from('project_images')
      .update({ reuse_pool_eligible: true })
      .eq('id', imageId);

    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    toast.success('Marked for reuse pool');
  }, [projectId, qc]);

  /**
   * Remove an image from reuse pool.
   */
  const removeFromReusePool = useCallback(async (imageId: string) => {
    await (supabase as any)
      .from('project_images')
      .update({ reuse_pool_eligible: false })
      .eq('id', imageId);

    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    toast.success('Removed from reuse pool');
  }, [projectId, qc]);

  /**
   * Approve a recommended image into active canon (promote to primary).
   */
  const approveIntoCanon = useCallback(async (image: ProjectImage) => {
    // Unset any existing primary in the same slot
    let deactivateQuery = (supabase as any)
      .from('project_images')
      .update({ is_primary: false })
      .eq('project_id', projectId)
      .eq('is_primary', true);

    if (image.asset_group) deactivateQuery = deactivateQuery.eq('asset_group', image.asset_group);
    if (image.subject) deactivateQuery = deactivateQuery.eq('subject', image.subject);
    if (image.shot_type) deactivateQuery = deactivateQuery.eq('shot_type', image.shot_type);
    if (image.generation_purpose) deactivateQuery = deactivateQuery.eq('generation_purpose', image.generation_purpose);

    await deactivateQuery;

    // Promote
    await (supabase as any)
      .from('project_images')
      .update({
        is_primary: true,
        is_active: true,
        curation_state: 'active' as CurationState,
        archived_from_active_at: null,
      })
      .eq('id', image.id);

    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
    toast.success('Approved into active canon');
  }, [projectId, qc]);

  /**
   * Reject a candidate (archive + optionally mark for reuse).
   */
  const rejectCandidate = useCallback(async (imageId: string, markReuse: boolean = false) => {
    const updates: Record<string, unknown> = {
      curation_state: 'rejected' as CurationState,
      is_active: false,
      is_primary: false,
    };
    if (markReuse) updates.reuse_pool_eligible = true;

    await (supabase as any)
      .from('project_images')
      .update(updates)
      .eq('id', imageId);

    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    toast.success(markReuse ? 'Rejected — added to reuse pool' : 'Rejected');
  }, [projectId, qc]);

  return {
    resetActiveCanon,
    restoreFromArchive,
    markForReusePool,
    removeFromReusePool,
    approveIntoCanon,
    rejectCandidate,
    resetting,
    lastReset,
  };
}
