/**
 * DDG Planner — Shadow mode comparison between ladder logic and DDG.
 *
 * SHADOW ONLY: The ladder_next is ALWAYS the authoritative answer.
 * DDG is computed for observation and IEL logging only.
 * This module MUST NOT influence promotion decisions.
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
  /** Ladder-based recommendation (AUTHORITATIVE — source of truth) */
  ladder_next: string | null;
  /** DDG-based recommendation (SHADOW ONLY — never used for decisions) */
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
 *
 * SHADOW MODE: The `ladder_next` is always the authoritative answer.
 * DDG is computed for observation only — NEVER used for promotion.
 */
export function computePlannerComparison(
  format: string,
  existingDocs: ExistingDoc[],
  criteria?: ProjectCriteria,
): PlannerResult {
  // 1. Compute ladder-based state (AUTHORITATIVE)
  const pipelineState = computePipelineState(format, existingDocs, criteria);
  const ladderPrimary = pipelineState.nextSteps.find(s => s.priority === 'primary');
  const ladderNext = ladderPrimary?.docType ?? null;

  // 2. Compute DDG state (SHADOW ONLY)
  const existingDocTypes = existingDocs.map(d => d.docType);
  const ddgState = computeDDGState(format, existingDocTypes);
  const ddgNext = ddgState.next_nodes[0] ?? null;

  // 3. Compare
  const ladderMapped = ladderNext ? mapDocTypeToLadderStage(ladderNext) : null;
  const match = ladderMapped === ddgNext;

  // 4. Log comparison with required IEL tags
  if (!match) {
    console.warn(`[ddg][IEL] ladder_ddg_mismatch { format: "${format}", ladder_next: "${ladderNext}", ddg_next: "${ddgNext}", ladder_key: "${ladderMapped}", existing_docs: [${existingDocTypes.join(',')}] }`);
  } else {
    console.log(`[ddg][IEL] ladder_ddg_match { format: "${format}", ladder_next: "${ladderNext}", ddg_next: "${ddgNext}", ladder_key: "${ladderMapped}" }`);
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
 * Compute DDG dirty nodes when a specific document changes.
 * SHADOW ONLY — for observation/logging.
 */
export function computeDirtyNodesForChange(
  format: string,
  changedDocType: string,
): string[] {
  const dirty = ddgComputeDirtyNodes(format, changedDocType);
  if (dirty.length > 0) {
    console.log(`[ddg][IEL] ddg_dirty_computed { format: "${format}", changed: "${changedDocType}", dirty: [${dirty.join(',')}] }`);
  }
  return dirty;
}
