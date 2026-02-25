/**
 * CIK Model Router — Deterministic model selection for CIK quality gate.
 * Frontend-side mirror of supabase/functions/_shared/cik/modelRouter.ts selectCikModel.
 * No randomness. No time-based decisions. Static constants only.
 *
 * Model names and lane overrides are derived from the canonical config in
 * cikModelConfig.ts. A drift-guard test ensures FE/BE stay in sync.
 */

import { CIK_MODEL_ROUTER_CONFIG } from "./cikModelConfig";

/* ── Model Constants (derived from canonical config) ── */

export const CIK_MODEL_ATTEMPT0_DEFAULT = CIK_MODEL_ROUTER_CONFIG.attempt0Default;
export const CIK_MODEL_ATTEMPT1_STRONG = CIK_MODEL_ROUTER_CONFIG.attempt1Strong;

/** Per-lane overrides (derived from canonical config). Unknown lanes fall back to defaults. */
const LANE_OVERRIDES = CIK_MODEL_ROUTER_CONFIG.laneOverrides;

/* ── Router Types ── */

export interface SelectCikModelParams {
  attemptIndex: 0 | 1;
  lane: string;
  adapterMode?: string | null;
  attempt0HardFailures?: string[];
}

export interface CikModelSelection {
  model: string;
  reason: string;
}

/* ── Router Function ── */

/**
 * Select model deterministically based on attempt index and prior hard failures.
 * - Attempt 0: always cheap default
 * - Attempt 1: strong model if attempt 0 had hard failures, else cheap default
 */
export function selectCikModel(params: SelectCikModelParams): CikModelSelection {
  const overrides = LANE_OVERRIDES[params.lane] || {};

  if (params.attemptIndex === 0) {
    return {
      model: overrides.attempt0 || CIK_MODEL_ATTEMPT0_DEFAULT,
      reason: "attempt0_default",
    };
  }

  // Attempt 1
  const hasHardFailures = (params.attempt0HardFailures || []).length > 0;

  if (hasHardFailures) {
    return {
      model: overrides.attempt1Strong || CIK_MODEL_ATTEMPT1_STRONG,
      reason: "attempt1_strong_due_to_hard_failures",
    };
  }

  return {
    model: overrides.attempt0 || CIK_MODEL_ATTEMPT0_DEFAULT,
    reason: "attempt1_default_no_hard_failures",
  };
}
