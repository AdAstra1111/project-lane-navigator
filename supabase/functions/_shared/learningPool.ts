/**
 * Learning Pool Eligibility Module
 * ─────────────────────────────────
 * Single source of truth for learning-pool qualification logic.
 * Used by generate-pitch, ci-blueprint-engine, and any other
 * authoritative pitch-idea write path.
 *
 * ARCHITECTURAL RULE: The CI threshold for learning-pool eligibility
 * is defined ONLY here. No other file may duplicate this constant.
 */

/** Minimum CI score for automatic learning-pool eligibility */
export const LEARNING_POOL_CI_THRESHOLD = 95;

export interface LearningPoolResult {
  learning_pool_eligible: boolean;
  learning_pool_eligibility_reason: string;
  learning_pool_qualified_at: string | null;
}

/**
 * Deterministic learning-pool qualification check.
 * Returns the fields to set on pitch_ideas rows.
 */
export function computeLearningPoolEligibility(scoreTotal: number): LearningPoolResult {
  if (scoreTotal >= LEARNING_POOL_CI_THRESHOLD) {
    return {
      learning_pool_eligible: true,
      learning_pool_eligibility_reason: "ci_95_threshold_met",
      learning_pool_qualified_at: new Date().toISOString(),
    };
  }
  return {
    learning_pool_eligible: false,
    learning_pool_eligibility_reason: "ci_below_threshold",
    learning_pool_qualified_at: null,
  };
}
