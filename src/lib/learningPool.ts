/**
 * Learning Pool Eligibility — Frontend Mirror
 * ─────────────────────────────────────────────
 * Single source of truth for learning-pool threshold on the client side.
 * Must stay in sync with supabase/functions/_shared/learningPool.ts.
 */

/** Minimum CI score for automatic learning-pool eligibility */
export const LEARNING_POOL_CI_THRESHOLD = 95;

/** Check if a pitch idea qualifies for the learning pool */
export function isLearningPoolEligible(scoreTotal: number): boolean {
  return scoreTotal >= LEARNING_POOL_CI_THRESHOLD;
}
