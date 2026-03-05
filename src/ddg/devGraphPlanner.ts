/**
 * DDG Planner — Shadow mode comparison between ladder logic and DDG.
 */

import { computeDDGState, computeDirtyNodes as ddgComputeDirtyNodes, type DDGState } from '@/ddg/devGraph';
import {
  computePipelineState,
  type PipelineState,
  type ExistingDoc,
  type ProjectCriteria,
} from '@/lib/pipeline-brain';
import { mapDocTypeToLadderStage } from '@/lib/stages/registry';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PlannerResult {
  /** Ladder-based recommendation (authoritative) */
  ladder_next: string | null;
  /** DDG-based recommendation (shadow) */
  ddg_next: string | null;
  /** Whether recommendations match */
  match: boolean;
  /** Full DDG state for inspection */
  ddg_state: DDGState;
  /** Full Pipeline Brain state for inspection */
  pipeline_state: PipelineState;
}

// ── Core Planner ───────────────────────────────────────────────────────────────

/**
 * Run both ladder and DDG planners in parallel, compare results, and log.
 * Returns the comparison result.
 *
 * SHADOW MODE: The `ladder_next` is always the authoritative answer.
 * DDG is computed for observation only.
 */
export function computePlannerComparison(
  format: string,
  existingDocs: ExistingDoc[],
  criteria?: ProjectCriteria,
): PlannerResult {
  // 1. Compute ladder-based state (authoritative)
  const pipelineState = computePipelineState(format, existingDocs, criteria);
  const ladderPrimary = pipelineState.nextSteps.find(s => s.priority === 'primary');
  const ladderNext = ladderPrimary?.docType ?? null;

  // 2. Compute DDG state (shadow)
  const existingDocTypes = existingDocs.map(d => d.docType);
  const ddgState = computeDDGState(format, existingDocTypes);
  const ddgNext = ddgState.next_nodes[0] ?? null;

  // 3. Compare
  const ladderMapped = ladderNext ? mapDocTypeToLadderStage(ladderNext) : null;
  const match = ladderMapped === ddgNext;

  // 4. Log comparison
  if (!match) {
    console.warn(`[IEL] ladder_ddg_mismatch { format: "${format}", ladder_next: "${ladderNext}", ddg_next: "${ddgNext}", existing_docs: [${existingDocTypes.join(',')}] }`);
  } else {
    console.log(`[IEL] ladder_ddg_match { format: "${format}", next: "${ladderNext}" }`);
  }

  return {
    ladder_next: ladderNext,
    ddg_next: ddgNext,
    match,
    ddg_state: ddgState,
    pipeline_state: pipelineState,
  };
}

/**
 * Convenience hook-compatible function: compute DDG dirty nodes
 * when a specific document changes.
 */
export function computeDirtyNodesForChange(
  format: string,
  changedDocType: string,
): string[] {
  const dirty = ddgComputeDirtyNodes(format, changedDocType);
  if (dirty.length > 0) {
    console.log(`[IEL] ddg_dirty_computed { format: "${format}", changed: "${changedDocType}", dirty: [${dirty.join(',')}] }`);
  }
  return dirty;
}
