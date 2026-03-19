/**
 * useVisualCanonReset — Deterministic Visual Canon Reset + Rebuild workflow.
 *
 * Supports scoped (section-level) and global resets.
 * Reset: Bulk archives/candidates active/primary images for a project without deleting.
 * Rebuild: Uses RequiredVisualSetResolver to show what needs to be filled.
 *
 * INVARIANT: is_primary=true requires curation_state='active'. Reset enforces this.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProjectImage, CurationState, AssetGroup } from '@/lib/images/types';

export interface CanonResetResult {
  batchId: string;
  archivedCount: number;
  primaryCleared: number;
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
    qc.invalidateQueries({ queryKey: ['canon-visual-alignment', projectId] });
  }, [qc, projectId]);

  /**
   * Execute a scoped visual canon reset.
   *
   * CRITICAL FIX: Two-phase approach ensures no orphaned primaries.
   *   Phase 1: Clear ALL is_primary in scope (regardless of curation_state)
   *   Phase 2: Move active/candidate images to target state
   *
   * Invariant enforced: after reset, 0 primaries exist in affected scope.
   */
  const resetScopedCanon = useCallback(async (options: ScopedResetOptions): Promise<CanonResetResult | null> => {
    if (resetting) return null;
    setResetting(true);

    try {
      const batchId = crypto.randomUUID();
      const now = new Date().toISOString();
      const isGlobal = options.sections.length === 0;

      // ── Phase 1: Clear ALL primaries in scope (unconditional) ──
      // This runs FIRST to guarantee no orphaned primaries survive.
      let primaryCleared = 0;
      if (options.clearPrimary) {
        let clearQuery = (supabase as any)
          .from('project_images')
          .update({ is_primary: false })
          .eq('project_id', projectId)
          .eq('is_primary', true);

        if (!isGlobal) {
          clearQuery = clearQuery.in('asset_group', options.sections);
        }

        const { data: clearedRows } = await clearQuery.select('id');
        primaryCleared = clearedRows?.length || 0;
      }

      // ── Phase 2: Move active/candidate images to target state ──
      let moveQuery = (supabase as any)
        .from('project_images')
        .update({
          curation_state: options.targetState,
          is_active: false,
          is_primary: false, // Belt-and-suspenders: also clear here
          archived_from_active_at: options.targetState === 'archived' ? now : null,
          canon_reset_batch_id: batchId,
        })
        .eq('project_id', projectId)
        .in('curation_state', ['active', 'candidate']);

      if (!isGlobal) {
        moveQuery = moveQuery.in('asset_group', options.sections);
      }

      const { data: affected, error } = await moveQuery.select('id');
      if (error) throw error;

      const archivedCount = affected?.length || 0;

      // ── Phase 3: Invariant verification ──
      // Verify 0 primaries remain in scope. If any survive, force-clear.
      let verifyQuery = (supabase as any)
        .from('project_images')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('is_primary', true);

      if (!isGlobal) {
        verifyQuery = verifyQuery.in('asset_group', options.sections);
      }

      const { count: remainingPrimaries } = await verifyQuery;
      if (remainingPrimaries && remainingPrimaries > 0) {
        // Safety net: force clear any remaining
        let forceQuery = (supabase as any)
          .from('project_images')
          .update({ is_primary: false })
          .eq('project_id', projectId)
          .eq('is_primary', true);
        if (!isGlobal) {
          forceQuery = forceQuery.in('asset_group', options.sections);
        }
        await forceQuery;
        console.warn(`[resetScopedCanon] Invariant enforcement: force-cleared ${remainingPrimaries} orphaned primaries`);
      }

      const result: CanonResetResult = {
        batchId,
        archivedCount,
        primaryCleared,
        timestamp: now,
        sections: isGlobal ? ['all'] : options.sections,
        options,
      };

      setLastReset(result);
      invalidateAll();

      const sectionLabel = isGlobal
        ? 'all sections'
        : options.sections.map(s => SECTION_LABELS[s] || s).join(', ');

      toast.success(`Visual canon reset (${sectionLabel}): ${archivedCount} images ${options.targetState === 'archived' ? 'archived' : 'moved to candidates'}, ${primaryCleared} primaries cleared.`);
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
        is_primary: false, // Invariant: restored images never auto-primary
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
   * Invariant: only one primary per slot.
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
   * Batch approve all candidates into active canon.
   * Deterministic primary selection: first candidate per slot (by created_at ASC).
   */
  const batchApproveAll = useCallback(async (candidates: ProjectImage[]): Promise<number> => {
    if (candidates.length === 0) return 0;

    // Group by slot key: asset_group + subject + shot_type
    const slotMap = new Map<string, ProjectImage[]>();
    for (const img of candidates) {
      const key = `${(img as any).asset_group || ''}:${img.subject || ''}:${img.shot_type || ''}`;
      if (!slotMap.has(key)) slotMap.set(key, []);
      slotMap.get(key)!.push(img);
    }

    let approved = 0;

    for (const [_slotKey, slotImages] of slotMap) {
      // Sort by created_at ASC — first candidate becomes primary
      const sorted = [...slotImages].sort((a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      for (let i = 0; i < sorted.length; i++) {
        const img = sorted[i];
        const isPrimary = i === 0; // First in slot becomes primary

        // Clear any existing primary in this slot before setting new one
        if (isPrimary) {
          let clearQ = (supabase as any)
            .from('project_images')
            .update({ is_primary: false })
            .eq('project_id', projectId)
            .eq('is_primary', true);
          if ((img as any).asset_group) clearQ = clearQ.eq('asset_group', (img as any).asset_group);
          if (img.subject) clearQ = clearQ.eq('subject', img.subject);
          if (img.shot_type) clearQ = clearQ.eq('shot_type', img.shot_type);
          await clearQ;
        }

        await (supabase as any)
          .from('project_images')
          .update({
            curation_state: 'active' as CurationState,
            is_active: true,
            is_primary: isPrimary,
            archived_from_active_at: null,
          })
          .eq('id', img.id);

        approved++;
      }
    }

    invalidateAll();
    toast.success(`Approved ${approved} images (${slotMap.size} slots with primaries selected)`);
    return approved;
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
    batchApproveAll,
    rejectCandidate,
    resetting,
    lastReset,
  };
}
