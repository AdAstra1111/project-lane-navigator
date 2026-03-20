/**
 * useLookbookAutoRebuild — Orchestration hook that evaluates rebuild triggers
 * and can launch the canonical executor from non-manual paths.
 *
 * Trigger policy:
 * - Evaluates on mount / when dependencies change
 * - Does NOT auto-launch destructive rebuilds without user confirmation
 * - Auto-launch only for preserve-mode when explicitly enabled
 * - Always persists runs via the canonical executor audit trail
 *
 * Consumers: LookBookPage, future mission-control surfaces.
 * Does NOT own rebuild logic — delegates to evaluateRebuildTrigger + executeCanonRebuild.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  evaluateRebuildTrigger,
  type RebuildTriggerDiagnostics,
  type RebuildTriggerCondition,
} from '@/lib/images/lookbookRebuildTrigger';
import {
  executeCanonRebuild,
  type RebuildExecutionResult,
  type RebuildTriggerSource,
} from '@/lib/images/canonRebuildExecutor';
import type { RebuildMode } from '@/lib/images/canonRebuildScoring';
import type { ProjectImage } from '@/lib/images/types';

// ── Public API ──

export interface LookbookAutoRebuildState {
  /** Latest trigger diagnostics (null while loading) */
  diagnostics: RebuildTriggerDiagnostics | null;
  /** Whether evaluation is in progress */
  evaluating: boolean;
  /** Whether a rebuild is currently running */
  rebuilding: boolean;
  /** Last execution result */
  lastResult: RebuildExecutionResult | null;
  /** Re-evaluate trigger conditions */
  reevaluate: () => void;
  /** Launch rebuild with recommended or explicit mode */
  launchRebuild: (opts?: {
    mode?: RebuildMode;
    triggerSource?: RebuildTriggerSource;
    explicitCondition?: RebuildTriggerCondition;
  }) => Promise<RebuildExecutionResult | null>;
}

interface UseLookbookAutoRebuildOptions {
  /** Callbacks the executor needs for generation/reset/refetch */
  generateSlotImages?: (targetKeys?: Set<string>) => Promise<void>;
  resetCanon?: () => Promise<void>;
  refetchImages?: () => Promise<{ data: ProjectImage[] | null }>;
  onLookbookRebuild?: () => Promise<void>;
  downloadWinners?: (ids: Set<string>) => Promise<void>;
  /** Progress callback */
  onStageChange?: (stage: string) => void;
  /** Called after a rebuild completes (for UI refresh) */
  onRebuildComplete?: (result: RebuildExecutionResult) => void;
}

export function useLookbookAutoRebuild(
  projectId: string | undefined,
  options: UseLookbookAutoRebuildOptions = {},
): LookbookAutoRebuildState {
  const [diagnostics, setDiagnostics] = useState<RebuildTriggerDiagnostics | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [lastResult, setLastResult] = useState<RebuildExecutionResult | null>(null);
  const evalCounter = useRef(0);

  // ── Evaluate trigger conditions ──
  const evaluate = useCallback(async () => {
    if (!projectId) return;
    setEvaluating(true);
    const evalId = ++evalCounter.current;

    try {
      // Fetch canon + project metadata + images in parallel
      const [canonRes, projectRes, imagesRes] = await Promise.all([
        (supabase as any).from('project_canon').select('canon_json').eq('project_id', projectId).maybeSingle(),
        (supabase as any).from('projects').select('format, assigned_lane').eq('id', projectId).maybeSingle(),
        (supabase as any).from('project_images').select('*').eq('project_id', projectId)
          .in('curation_state', ['active', 'candidate', 'archived', 'rejected']).limit(500),
      ]);

      // Stale check
      if (evalId !== evalCounter.current) return;

      const canonJson = canonRes.data?.canon_json || {};
      const format = (projectRes.data?.format || '').toLowerCase();
      const lane = projectRes.data?.assigned_lane || '';
      const isVD = format.includes('vertical') || lane === 'vertical_drama';
      const images = (imagesRes.data || []) as ProjectImage[];

      const result = evaluateRebuildTrigger(canonJson, images, isVD, format, lane);

      if (evalId === evalCounter.current) {
        setDiagnostics(result);
        console.log('[auto-rebuild] Trigger evaluation:', {
          shouldRebuild: result.shouldRebuild,
          conditions: result.conditions,
          recommendedMode: result.recommendedMode,
          slotSummary: result.slotSummary,
        });
      }
    } catch (err: any) {
      console.error('[auto-rebuild] Evaluation failed:', err.message);
    } finally {
      if (evalId === evalCounter.current) {
        setEvaluating(false);
      }
    }
  }, [projectId]);

  // Auto-evaluate on mount and when projectId changes
  useEffect(() => {
    evaluate();
  }, [evaluate]);

  // ── Launch rebuild ──
  const launchRebuild = useCallback(async (opts?: {
    mode?: RebuildMode;
    triggerSource?: RebuildTriggerSource;
    explicitCondition?: RebuildTriggerCondition;
  }): Promise<RebuildExecutionResult | null> => {
    if (!projectId || rebuilding) return null;

    // Re-evaluate if needed to get fresh diagnostics
    let currentDiagnostics = diagnostics;
    if (!currentDiagnostics) {
      // Inline evaluation for fresh data
      try {
        const [canonRes, projectRes, imagesRes] = await Promise.all([
          (supabase as any).from('project_canon').select('canon_json').eq('project_id', projectId).maybeSingle(),
          (supabase as any).from('projects').select('format, assigned_lane').eq('id', projectId).maybeSingle(),
          (supabase as any).from('project_images').select('*').eq('project_id', projectId)
            .in('curation_state', ['active', 'candidate', 'archived', 'rejected']).limit(500),
        ]);

        const canonJson = canonRes.data?.canon_json || {};
        const format = (projectRes.data?.format || '').toLowerCase();
        const lane = projectRes.data?.assigned_lane || '';
        const isVD = format.includes('vertical') || lane === 'vertical_drama';
        const images = (imagesRes.data || []) as ProjectImage[];

        currentDiagnostics = evaluateRebuildTrigger(
          canonJson, images, isVD, format, lane,
          { explicitCondition: opts?.explicitCondition },
        );
      } catch (err: any) {
        console.error('[auto-rebuild] Pre-launch evaluation failed:', err.message);
        return null;
      }
    }

    const mode = opts?.mode || currentDiagnostics.recommendedMode;
    const triggerSource = opts?.triggerSource || 'auto_run';

    // Check if rebuild is actually needed (unless forced)
    if (!currentDiagnostics.shouldRebuild && !opts?.explicitCondition) {
      console.log('[auto-rebuild] No rebuild needed — skipping launch');
      return null;
    }

    setRebuilding(true);

    try {
      // Fetch fresh data for executor
      const [canonRes, projectRes] = await Promise.all([
        (supabase as any).from('project_canon').select('canon_json').eq('project_id', projectId).maybeSingle(),
        (supabase as any).from('projects').select('format, assigned_lane').eq('id', projectId).maybeSingle(),
      ]);

      const canonJson = canonRes.data?.canon_json || {};
      const format = (projectRes.data?.format || '').toLowerCase();
      const lane = projectRes.data?.assigned_lane || '';
      const isVD = format.includes('vertical') || lane === 'vertical_drama';

      console.log(`[auto-rebuild] Launching ${mode} rebuild (trigger: ${triggerSource})`);

      const result = await executeCanonRebuild({
        projectId,
        mode,
        triggerSource,
        canonJson,
        projectFormat: format,
        projectLane: lane,
        isVerticalDrama: isVD,
        onStageChange: options.onStageChange,
        generateSlotImages: options.generateSlotImages,
        resetCanon: options.resetCanon,
        refetchImages: options.refetchImages,
        onLookbookRebuild: options.onLookbookRebuild,
        downloadWinners: options.downloadWinners,
      });

      setLastResult(result);

      console.log('[auto-rebuild] Execution complete:', {
        status: result.executionStatus,
        durationMs: result.durationMs,
        resolved: result.rebuildResult.resolvedSlots,
        unresolved: result.rebuildResult.unresolvedSlots,
      });

      // Notify caller
      options.onRebuildComplete?.(result);

      // Re-evaluate after rebuild
      await evaluate();

      return result;
    } catch (err: any) {
      console.error('[auto-rebuild] Launch failed:', err.message);
      return null;
    } finally {
      setRebuilding(false);
    }
  }, [projectId, rebuilding, diagnostics, evaluate, options]);

  return {
    diagnostics,
    evaluating,
    rebuilding,
    lastResult,
    reevaluate: evaluate,
    launchRebuild,
  };
}
