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
import { runDnaPreflightForRebuild, type DnaAutoFlowConfig } from './dnaAutoFlow';

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

// ── Canonical Execution Stages ──

export const REBUILD_STAGES = [
  'analysing_incumbents',
  'resetting_canon',
  'generating_images',
  'scoring_candidates',
  'evaluating_replacements',
  'attaching_winners',
  'building_lookbook',
  'preparing_download',
] as const;

export type RebuildStage = typeof REBUILD_STAGES[number];

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
  failureStage: RebuildStage | null;
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

// ── Persist Execution Record ──

async function persistRebuildRun(
  projectId: string,
  result: RebuildExecutionResult,
): Promise<void> {
  try {
    const payload = {
      project_id: projectId,
      trigger_source: result.triggerSource,
      rebuild_mode: result.rebuildResult.mode,
      execution_status: result.executionStatus,
      targeted_slot_keys: result.targetedSlotKeys || [],
      started_at: result.startedAt,
      completed_at: result.completedAt,
      duration_ms: result.durationMs,
      failure_stage: result.failureStage,
      failure_message: result.failureMessage,
      total_slots: result.rebuildResult.totalSlots,
      resolved_slots: result.rebuildResult.resolvedSlots,
      unresolved_slots: result.rebuildResult.unresolvedSlots,
      generated_count: result.newlyGeneratedCount,
      compliant_count: result.rebuildResult.compliantCount,
      rejected_non_compliant_count: result.rebuildResult.rejectedNonCompliantCount,
      attached_winner_count: result.rebuildResult.attachedWinnerCount,
      preserved_primary_count: result.rebuildResult.preservedPrimaryCount,
      replaced_primary_count: result.rebuildResult.replacedPrimaryCount,
      winner_ids: result.rebuildResult.winnerIds,
      unresolved_reasons: result.rebuildResult.unresolvedReasons,
    };

    const { error } = await (supabase as any)
      .from('lookbook_rebuild_runs')
      .insert(payload);

    if (error) {
      console.error('[rebuild-executor] Failed to persist rebuild run:', error.message);
    } else {
      console.log(`[rebuild-executor] Persisted rebuild run: ${result.executionStatus}`);
    }
  } catch (e: any) {
    // Persistence failure must not block the rebuild result
    console.error('[rebuild-executor] Persistence error (non-fatal):', e.message);
  }
}

// ── Read Rebuild History ──

export interface LookbookRebuildRun {
  id: string;
  project_id: string;
  trigger_source: string;
  rebuild_mode: string;
  execution_status: string;
  targeted_slot_keys: string[];
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  failure_stage: string | null;
  failure_message: string | null;
  total_slots: number;
  resolved_slots: number;
  unresolved_slots: number;
  generated_count: number;
  compliant_count: number;
  rejected_non_compliant_count: number;
  attached_winner_count: number;
  preserved_primary_count: number;
  replaced_primary_count: number;
  winner_ids: string[];
  unresolved_reasons: Array<{ slotKey: string; reason: string }>;
}

export async function fetchRecentRebuildRuns(
  projectId: string,
  limit = 10,
): Promise<LookbookRebuildRun[]> {
  const { data, error } = await (supabase as any)
    .from('lookbook_rebuild_runs')
    .select('*')
    .eq('project_id', projectId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as LookbookRebuildRun[];
}

// ── Stage Tracker ──

class StageTracker {
  currentStage: RebuildStage | null = null;

  advance(stage: RebuildStage, callback?: (s: string) => void) {
    this.currentStage = stage;
    callback?.(stage);
  }

  /** Returns the last known stage at point of failure */
  get failureStage(): RebuildStage | null {
    return this.currentStage;
  }
}

// ── Main Executor ──

export async function executeCanonRebuild(
  input: RebuildExecutionInput,
): Promise<RebuildExecutionResult> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const { projectId, mode, triggerSource, canonJson, isVerticalDrama, projectFormat, projectLane } = input;
  const isPreserve = mode === 'PRESERVE_PRIMARIES_FULL_CANON_REBUILD';
  const tracker = new StageTracker();

  let preGenImageCount = 0;
  let newlyGeneratedCount = 0;

  try {
    // ── DNA Preflight: Strengthen canonical identity state before rebuild ──
    console.log('[rebuild-executor] Running DNA preflight...');
    try {
      const preflightResult = await runDnaPreflightForRebuild(projectId, canonJson);
      console.log(`[rebuild-executor] DNA preflight: ${preflightResult.charactersProcessed} chars, ${preflightResult.charactersPersisted} persisted`);
    } catch (e: any) {
      // Non-fatal — rebuild continues with existing DNA state
      console.warn('[rebuild-executor] DNA preflight failed (non-fatal):', e.message);
    }
    // ── Phase 1: Pre-generation analysis ──
    let preGenImages: ProjectImage[] = [];

    if (isPreserve) {
      tracker.advance('analysing_incumbents', input.onStageChange);
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
        tracker.advance('generating_images', input.onStageChange);
        await input.generateSlotImages(finalTargetKeys);
        await new Promise(r => setTimeout(r, 500));
      } else if (finalTargetKeys.size === 0) {
        // No-op preserve run
        const rebuildResult = buildRebuildResult(mode, [], 0);
        const result: RebuildExecutionResult = {
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
        await persistRebuildRun(projectId, result);
        return result;
      }
    } else {
      // ── RESET MODE ──
      tracker.advance('resetting_canon', input.onStageChange);
      if (input.resetCanon) {
        await input.resetCanon();
      }

      const resetImages = input.refetchImages
        ? ((await input.refetchImages())?.data || []) as ProjectImage[]
        : await fetchProjectImages(projectId);
      preGenImageCount = resetImages.length;

      await new Promise(r => setTimeout(r, 500));

      // Generate full visual set
      tracker.advance('generating_images', input.onStageChange);
      if (input.generateSlotImages) {
        await input.generateSlotImages(input.targetSlotKeys);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // ── Phase 2: Post-generation scoring ──
    tracker.advance('scoring_candidates', input.onStageChange);

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
      tracker.advance('evaluating_replacements', input.onStageChange);
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
    tracker.advance('attaching_winners', input.onStageChange);

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
    tracker.advance('building_lookbook', input.onStageChange);
    if (input.onLookbookRebuild) {
      await input.onLookbookRebuild();
    }

    tracker.advance('preparing_download', input.onStageChange);
    if (input.downloadWinners) {
      await input.downloadWinners(winnerIds);
    }

    input.onStageChange?.('Complete');

    // Determine execution status
    const executionStatus: RebuildExecutionStatus =
      rebuildResult.unresolvedSlots > 0 ? 'completed_with_unresolved' : 'completed';

    const executionResult: RebuildExecutionResult = {
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

    // Persist audit record
    await persistRebuildRun(projectId, executionResult);

    return executionResult;
  } catch (err: any) {
    const failureMessage = err.message || 'Unknown error';
    console.error(`[rebuild-executor] Failed at stage '${tracker.currentStage}':`, err);

    // Return a failed result with empty rebuild data
    const emptyResult = buildRebuildResult(mode, [], 0);
    const executionResult: RebuildExecutionResult = {
      rebuildResult: emptyResult,
      executionStatus: 'failed',
      triggerSource,
      targetedSlotKeys: input.targetSlotKeys ? Array.from(input.targetSlotKeys) : null,
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      failureStage: tracker.failureStage,
      failureMessage,
      newlyGeneratedCount: 0,
    };

    // Persist even failed runs for auditability
    await persistRebuildRun(projectId, executionResult);

    return executionResult;
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
