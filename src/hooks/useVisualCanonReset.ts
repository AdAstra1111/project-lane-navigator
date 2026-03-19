/**
 * useVisualCanonReset — Deterministic Visual Canon Reset + Rebuild workflow.
 *
 * Supports scoped (section-level) and global resets.
 * Reset: Bulk archives/candidates active/primary images for a project without deleting.
 * Rebuild: Uses RequiredVisualSetResolver to show what needs to be filled.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, CurationState, AssetGroup } from '@/lib/images/types';

export interface CanonResetResult {
  batchId: string;
  archivedCount: number;
  timestamp: string;
  sections: string[];
  options: ScopedResetOptions;
}

export interface ScopedResetOptions {
  /** Which asset_group sections to reset. Empty = all. */
  sections: string[];
  /** Clear is_primary on affected images (default true) */
  clearPrimary: boolean;
  /** Target curation_state for affected images */
  targetState: 'candidate' | 'archived';
  /** Trigger regeneration after reset */
  regenerateAfter: boolean;
}

/** Section metadata for the reset modal */
export interface ResetSectionInfo {
  assetGroup: string;
  label: string;
  primaryCount: number;
  activeCount: number;
  candidateCount: number;
  totalCount: number;
}

const SECTION_LABELS: Record<string, string> = {
  character: 'Characters',
  world: 'World & Locations',
  visual_language: 'Visual Language',
  key_moment: 'Key Moments',
  poster: 'Poster Directions',
};

/** Compute section info from loaded images */
export function computeSectionInfo(images: ProjectImage[]): ResetSectionInfo[] {
  const groups = new Map<string, { primary: number; active: number; candidate: number; total: number }>();

  for (const img of images) {
    const ag = (img as any).asset_group as string | null;
    if (!ag) continue;
    if (!groups.has(ag)) groups.set(ag, { primary: 0, active: 0, candidate: 0, total: 0 });
    const g = groups.get(ag)!;
    g.total++;
    if (img.is_primary) g.primary++;
    if (img.curation_state === 'active') g.active++;
    if (img.curation_state === 'candidate') g.candidate++;
  }

  return Array.from(groups.entries())
    .map(([ag, counts]) => ({
      assetGroup: ag,
      label: SECTION_LABELS[ag] || ag,
      primaryCount: counts.primary,
      activeCount: counts.active,
      candidateCount: counts.candidate,
      totalCount: counts.total,
    }))
    .sort((a, b) => {
      const order = ['character', 'world', 'visual_language', 'key_moment', 'poster'];
      return (order.indexOf(a.assetGroup) ?? 99) - (order.indexOf(b.assetGroup) ?? 99);
    });
}

export function useVisualCanonReset(projectId: string) {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const [lastReset, setLastReset] = useState<CanonResetResult | null>(null);

  const invalidateAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['project-images', projectId] });
    qc.invalidateQueries({ queryKey: ['project-images-paginated', projectId] });
    qc.invalidateQueries({ queryKey: ['section-images', projectId] });
  }, [qc, projectId]);

  /**
   * Execute a scoped visual canon reset.
   * - Targets only selected asset_group sections
   * - Clears is_primary if option set
   * - Moves images to candidate or archived state
   * - Records batch ID for audit
   * - Does NOT delete any images
   * - Does NOT alter lane_key or prestige_style
   */
  const resetScopedCanon = useCallback(async (options: ScopedResetOptions): Promise<CanonResetResult | null> => {
    if (resetting) return null;
    setResetting(true);

    try {
      const batchId = crypto.randomUUID();
      const now = new Date().toISOString();
      const isGlobal = options.sections.length === 0;

      // Build base query for affected images
      let query = (supabase as any)
        .from('project_images')
        .update({
          curation_state: options.targetState as CurationState,
          is_active: options.targetState === 'candidate',
          is_primary: options.clearPrimary ? false : undefined,
          ...(options.clearPrimary ? { is_primary: false } : {}),
          archived_from_active_at: options.targetState === 'archived' ? now : null,
          canon_reset_batch_id: batchId,
        })
        .eq('project_id', projectId)
        .in('curation_state', ['active', 'candidate']);

      // Scope to selected sections if not global
      if (!isGlobal) {
        query = query.in('asset_group', options.sections);
      }

      const { data: affected, error } = await query.select('id');
      if (error) throw error;

      const archivedCount = affected?.length || 0;

      // Invariant enforcement: if clearPrimary, ensure 0 primaries remain in affected sections
      if (options.clearPrimary && !isGlobal) {
        await (supabase as any)
          .from('project_images')
          .update({ is_primary: false })
          .eq('project_id', projectId)
          .eq('is_primary', true)
          .in('asset_group', options.sections);
      } else if (options.clearPrimary && isGlobal) {
        await (supabase as any)
          .from('project_images')
          .update({ is_primary: false })
          .eq('project_id', projectId)
          .eq('is_primary', true);
      }

      const result: CanonResetResult = {
        batchId,
        archivedCount,
        timestamp: now,
        sections: isGlobal ? ['all'] : options.sections,
        options,
      };

      setLastReset(result);
      invalidateAll();

      const sectionLabel = isGlobal
        ? 'all sections'
        : options.sections.map(s => SECTION_LABELS[s] || s).join(', ');

      toast.success(`Visual canon reset (${sectionLabel}): ${archivedCount} images ${options.targetState === 'archived' ? 'archived' : 'moved to candidates'}.`);
      return result;
    } catch (e: any) {
      toast.error(e.message || 'Failed to reset visual canon');
      return null;
    } finally {
      setResetting(false);
    }
  }, [projectId, resetting, invalidateAll]);

  /**
   * Legacy global reset — now delegates to scoped reset with all sections.
   */
  const resetActiveCanon = useCallback(async (): Promise<CanonResetResult | null> => {
    return resetScopedCanon({
      sections: [],
      clearPrimary: true,
      targetState: 'archived',
      regenerateAfter: false,
    });
  }, [resetScopedCanon]);

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

    invalidateAll();
    toast.success('Image restored as candidate');
  }, [invalidateAll]);

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

    if ((image as any).asset_group) deactivateQuery = deactivateQuery.eq('asset_group', (image as any).asset_group);
    if (image.subject) deactivateQuery = deactivateQuery.eq('subject', image.subject);
    if (image.shot_type) deactivateQuery = deactivateQuery.eq('shot_type', image.shot_type);
    if ((image as any).generation_purpose) deactivateQuery = deactivateQuery.eq('generation_purpose', (image as any).generation_purpose);

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

    invalidateAll();
    toast.success('Approved into active canon');
  }, [projectId, invalidateAll]);

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
    resetScopedCanon,
    restoreFromArchive,
    markForReusePool,
    removeFromReusePool,
    approveIntoCanon,
    rejectCandidate,
    resetting,
    lastReset,
  };
}
