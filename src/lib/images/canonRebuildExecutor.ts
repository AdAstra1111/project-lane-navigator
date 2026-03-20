/**
 * Canon Rebuild Executor — Canonical non-UI rebuild pipeline.
 *
 * Centralizes all rebuild business logic that was previously owned by
 * VisualCanonResetPanel. Can be invoked from UI, auto-run, or pipeline paths.
 *
 * Reuses existing canonical systems:
 *   - canonRebuildScoring (scoring, winner selection, RebuildResult)
 *   - requiredVisualSet (slot resolution)
 *   - verticalCompliance (measured orientation truth)
 *
 * Does NOT contain any React/UI logic. Pure async execution.
 */

import { supabase } from '@/integrations/supabase/client';
import { resolveRequiredVisualSet, getDimensionsForShot, type RequiredSlot } from './requiredVisualSet';
import {
  scoreAndSelectAllSlots,
  buildRebuildResult,
  buildAlignmentAnchors,
  classifySlotWeakness,
  type SlotTarget,
  type SlotWinnerResult,
  type RebuildMode,
  type RebuildResult,
} from './canonRebuildScoring';
import type { ProjectImage } from './types';

// ── Execution Status ──

export type RebuildExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'completed_with_unresolved'
  | 'no_op'
  | 'failed';

// ── Trigger Source ──

export type RebuildTriggerSource =
  | 'manual_ui'
  | 'pipeline'
  | 'auto_run'
  | 'scheduled';

// ── Execution Input ──

export interface RebuildExecutionInput {
  projectId: string;
  mode: RebuildMode;
  triggerSource: RebuildTriggerSource;
  /** If provided, only rebuild these slot keys (subset rebuild) */
  targetSlotKeys?: Set<string>;
  /** Canon JSON for entity extraction */
  canonJson: any;
  /** Project format string */
  projectFormat: string;
  /** Project lane string */
  projectLane: string;
  /** Whether this is a vertical drama project */
  isVerticalDrama: boolean;
  /** Optional callbacks for progress reporting (UI can hook in) */
  onStageChange?: (stage: string) => void;
  /** Optional: abort signal */
  abortSignal?: { aborted: boolean };
  /** Optional: function to generate images for slots */
  generateSlotImages?: (targetSlotKeys?: Set<string>) => Promise<void>;
  /** Optional: function to reset/archive current canon */
  resetCanon?: () => Promise<void>;
  /** Optional: function to refetch images from DB */
  refetchImages?: () => Promise<{ data: ProjectImage[] | null }>;
  /** Optional: post-rebuild callbacks */
  onLookbookRebuild?: () => Promise<void>;
  /** Optional: download winners */
  downloadWinners?: (winnerIds: Set<string>) => Promise<void>;
}

// ── Execution Result ──

export interface RebuildExecutionResult {
  /** Canonical rebuild result (scoring/winner data) */
  rebuildResult: RebuildResult;
  /** Pipeline execution status */
  executionStatus: RebuildExecutionStatus;
  /** What triggered the rebuild */
  triggerSource: RebuildTriggerSource;
  /** Slot keys that were targeted (null = all) */
  targetedSlotKeys: string[] | null;
  /** Timestamps */
  startedAt: string;
  completedAt: string;
  /** Duration in ms */
  durationMs: number;
  /** Stage where failure occurred, if any */
  failureStage: string | null;
  /** Error message if failed */
  failureMessage: string | null;
  /** Newly generated image count (true per-run delta) */
  newlyGeneratedCount: number;
}

// ── Entity Extraction (canonical, shared) ──

export function extractEntities(canonJson: any): { characters: { name: string }[]; locations: { name: string }[] } {
  const characters: { name: string }[] = [];
  const locations: { name: string }[] = [];

  if (canonJson?.characters && Array.isArray(canonJson.characters)) {
    for (const c of canonJson.characters) {
      const name = typeof c === 'string' ? c.trim() : (c.name || c.character_name || '').trim();
      if (name && name !== 'Unknown') characters.push({ name });
    }
  }

  if (canonJson?.locations && Array.isArray(canonJson.locations)) {
    for (const l of canonJson.locations) {
      const name = typeof l === 'string' ? l.trim() : (l.name || l.location_name || '').trim();
      if (name) locations.push({ name });
    }
  }

  return { characters: characters.slice(0, 10), locations: locations.slice(0, 10) };
}

// ── Fetch Images Helper ──

async function fetchProjectImages(projectId: string): Promise<ProjectImage[]> {
  const { data } = await (supabase as any)
    .from('project_images')
    .select('*')
    .eq('project_id', projectId)
    .in('curation_state', ['active', 'candidate', 'archived', 'rejected'])
    .limit(500);
  return (data || []) as ProjectImage[];
}

// ── Main Executor ──

export async function executeCanonRebuild(
  input: RebuildExecutionInput,
): Promise<RebuildExecutionResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const { projectId, mode, triggerSource, canonJson, isVerticalDrama, projectFormat, projectLane } = input;
  const isPreserve = mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD';
  const stage = (s: string) => input.onStageChange?.(s);

  let failureStage: string | null = null;
  let failureMessage: string | null = null;
  let preGenImageCount = 0;
  let newlyGeneratedCount = 0;

  try {
    // ── Phase 1: Pre-generation analysis ──
    let preGenImages: ProjectImage[] = [];

    if (isPreserve) {
      stage('Analysing incumbents');
      preGenImages = input.refetchImages
        ? ((await input.refetchImages())?.data || []) as ProjectImage[]
        : await fetchProjectImages(projectId);
      preGenImageCount = preGenImages.length;

      const freshEntities = extractEntities(canonJson);
      const freshRequired = resolveRequiredVisualSet(
        freshEntities.characters, freshEntities.locations, preGenImages, isVerticalDrama,
      );

      // Classify slot weakness
      const slotTargets: SlotTarget[] = freshRequired.slots.map(s => ({
        key: s.key,
        assetGroup: s.assetGroup,
        subject: s.subject,
        shotType: s.shotType || '',
        expectedAspectRatio: s.aspectRatio,
        isIdentity: s.isIdentity,
      }));

      const weakSlotKeys = new Set<string>();
      for (const slot of freshRequired.slots) {
        const target = slotTargets.find(t => t.key === slot.key);
        if (!target) continue;
        const weakness = classifySlotWeakness(
          slot.primaryImage, target, isVerticalDrama, projectFormat, projectLane,
        );
        if (weakness.isWeak) {
          weakSlotKeys.add(slot.key);
          console.log(`[rebuild-executor] Weak slot: ${slot.key} — reasons: ${weakness.reasons.join(', ')}`);
        }
      }

      // Merge with explicit target keys if provided
      const finalTargetKeys = input.targetSlotKeys
        ? new Set([...input.targetSlotKeys, ...weakSlotKeys])
        : weakSlotKeys;

      console.log(`[rebuild-executor] ${finalTargetKeys.size} of ${freshRequired.slots.length} slots targeted`);

      // Generate only targeted slots
      if (finalTargetKeys.size > 0 && input.generateSlotImages) {
        stage('Generating missing slots');
        await input.generateSlotImages(finalTargetKeys);
        await new Promise(r => setTimeout(r, 500));
      } else if (finalTargetKeys.size === 0) {
        // No-op preserve run
        const rebuildResult = buildRebuildResult(mode, [], 0);
        return {
          rebuildResult,
          executionStatus: 'no_op',
          triggerSource,
          targetedSlotKeys: [],
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
          failureStage: null,
          failureMessage: null,
          newlyGeneratedCount: 0,
        };
      }
    } else {
      // ── RESET MODE ──
      stage('Resetting canon');
      if (input.resetCanon) {
        await input.resetCanon();
      }

      const resetImages = input.refetchImages
        ? ((await input.refetchImages())?.data || []) as ProjectImage[]
        : await fetchProjectImages(projectId);
      preGenImageCount = resetImages.length;

      stage('Archiving images');
      await new Promise(r => setTimeout(r, 500));

      // Generate full visual set
      stage('Generating images');
      if (input.generateSlotImages) {
        await input.generateSlotImages(input.targetSlotKeys);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── Phase 2: Post-generation scoring ──
    stage('Scoring candidates');

    const postGenImages = input.refetchImages
      ? ((await input.refetchImages())?.data || []) as ProjectImage[]
      : await fetchProjectImages(projectId);

    newlyGeneratedCount = Math.max(0, postGenImages.length - preGenImageCount);

    const freshEntities = extractEntities(canonJson);
    const freshRequired = resolveRequiredVisualSet(
      freshEntities.characters, freshEntities.locations, postGenImages, isVerticalDrama,
    );

    const slotTargets: SlotTarget[] = freshRequired.slots.map(s => ({
      key: s.key,
      assetGroup: s.assetGroup,
      subject: s.subject,
      shotType: s.shotType || '',
      expectedAspectRatio: s.aspectRatio,
      isIdentity: s.isIdentity,
    }));

    const imagesBySlotKey = new Map<string, ProjectImage[]>();
    for (const slot of freshRequired.slots) {
      imagesBySlotKey.set(slot.key, slot.candidates);
    }

    // Build preserve-mode context
    const incumbentsBySlotKey = new Map<string, ProjectImage | null>();
    let anchors = undefined as ReturnType<typeof buildAlignmentAnchors> | undefined;

    if (isPreserve) {
      stage('Evaluating replacements');
      const primaryImages = postGenImages.filter(i => i.is_primary && i.curation_state === 'active');
      anchors = buildAlignmentAnchors(primaryImages);
      for (const slot of freshRequired.slots) {
        incumbentsBySlotKey.set(slot.key, slot.primaryImage);
      }
    }

    // Run deterministic scoring
    const slotResults = scoreAndSelectAllSlots(
      slotTargets, imagesBySlotKey, isVerticalDrama, projectFormat, projectLane,
      { mode, anchors, incumbentsBySlotKey: isPreserve ? incumbentsBySlotKey : undefined },
    );

    const rebuildResult = buildRebuildResult(mode, slotResults, newlyGeneratedCount);
    const winnerIds = new Set(rebuildResult.winnerIds);

    console.log(`[rebuild-executor] [${mode}] Scoring complete:`, {
      ...rebuildResult,
      isVerticalDrama,
    });

    // ── Phase 3: Attach winners ──
    stage('Attaching winners');

    for (const result of slotResults) {
      if (!result.winner) continue;
      if (result.complianceGate && !result.complianceGate.allowed) {
        console.warn(`[rebuild-executor] Compliance gate BLOCKED: ${result.slotKey}: ${result.complianceGate.reason}`);
        continue;
      }

      // In preserve mode, skip if incumbent preserved
      if (isPreserve && result.incumbentPreserved && result.incumbentId === result.winner.imageId) {
        continue;
      }

      const winnerId = result.winner.imageId;

      // Clear any existing primary in this slot
      const slotInfo = freshRequired.slots.find(s => s.key === result.slotKey);
      if (slotInfo) {
        let clearQ = (supabase as any)
          .from('project_images')
          .update({ is_primary: false })
          .eq('project_id', projectId)
          .eq('is_primary', true);
        if (slotInfo.assetGroup) clearQ = clearQ.eq('asset_group', slotInfo.assetGroup);
        if (slotInfo.subject) clearQ = clearQ.eq('subject', slotInfo.subject);
        if (slotInfo.shotType) clearQ = clearQ.eq('shot_type', slotInfo.shotType);
        await clearQ;
      }

      // Promote winner
      await (supabase as any)
        .from('project_images')
        .update({
          curation_state: 'active',
          is_active: true,
          is_primary: true,
          archived_from_active_at: null,
        })
        .eq('id', winnerId);
    }

    // Demote non-winners in reset mode
    if (!isPreserve) {
      const allCandidateIds = postGenImages
        .filter(i => i.curation_state === 'candidate' || i.curation_state === 'active')
        .map(i => i.id)
        .filter(id => !winnerIds.has(id));

      if (allCandidateIds.length > 0) {
        for (let i = 0; i < allCandidateIds.length; i += 50) {
          const chunk = allCandidateIds.slice(i, i + 50);
          await (supabase as any)
            .from('project_images')
            .update({
              curation_state: 'candidate',
              is_active: false,
              is_primary: false,
            })
            .in('id', chunk);
        }
      }
    }

    // Refresh
    if (input.refetchImages) await input.refetchImages();

    // ── Phase 4: Post-rebuild actions ──
    stage('Building lookbook');
    if (input.onLookbookRebuild) {
      await input.onLookbookRebuild();
    }

    stage('Preparing download');
    if (input.downloadWinners) {
      await input.downloadWinners(winnerIds);
    }

    stage('Complete');

    // Determine execution status
    const executionStatus: RebuildExecutionStatus =
      rebuildResult.unresolvedSlots > 0 ? 'completed_with_unresolved' : 'completed';

    return {
      rebuildResult,
      executionStatus,
      triggerSource,
      targetedSlotKeys: input.targetSlotKeys ? Array.from(input.targetSlotKeys) : null,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      failureStage: null,
      failureMessage: null,
      newlyGeneratedCount,
    };
  } catch (err: any) {
    failureStage = input.onStageChange ? 'unknown' : null;
    failureMessage = err.message || 'Unknown error';
    console.error(`[rebuild-executor] Failed:`, err);

    // Return a failed result with empty rebuild data
    const emptyResult = buildRebuildResult(mode, [], 0);
    return {
      rebuildResult: emptyResult,
      executionStatus: 'failed',
      triggerSource,
      targetedSlotKeys: input.targetSlotKeys ? Array.from(input.targetSlotKeys) : null,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      failureStage,
      failureMessage,
      newlyGeneratedCount: 0,
    };
  }
}

// ── Execution Status Helpers ──

export function isRebuildSuccess(status: RebuildExecutionStatus): boolean {
  return status === 'completed' || status === 'no_op';
}

export function isRebuildPartial(status: RebuildExecutionStatus): boolean {
  return status === 'completed_with_unresolved';
}

export function getRebuildStatusSeverity(status: RebuildExecutionStatus): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'completed': return 'success';
    case 'no_op': return 'neutral';
    case 'completed_with_unresolved': return 'warning';
    case 'failed': return 'error';
    default: return 'neutral';
  }
}

export function getRebuildStatusLabel(status: RebuildExecutionStatus): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'running': return 'Running';
    case 'completed': return 'Completed';
    case 'completed_with_unresolved': return 'Completed (unresolved slots)';
    case 'no_op': return 'No action needed';
    case 'failed': return 'Failed';
  }
}
