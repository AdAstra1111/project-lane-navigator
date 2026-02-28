/**
 * Convergence Policy v1 — Attempt Ladder + Strategy Selection
 * Deterministic, bounded, resumable.
 */

// ── Platform Defaults ──
export const DEFAULT_MAX_TOTAL_STEPS = 300;
export const DEFAULT_MAX_STAGE_LOOPS = 10;
export const MAX_TOTAL_ATTEMPTS_PER_TARGET = 24;

// ── Attempt Strategies ──
export type AttemptStrategy =
  | "TARGETED_BLOCKERS"
  | "HIGH_IMPACT_ONLY"
  | "STRUCTURE_REPAIR"
  | "FORK_CONSERVATIVE_AGGRESSIVE"
  | "FULL_REWRITE_CONSTRAINED";

/**
 * Deterministic strategy selection based on 1-indexed attempt number.
 */
export function getAttemptStrategy(attemptNumber: number): AttemptStrategy {
  switch (attemptNumber) {
    case 1: return "TARGETED_BLOCKERS";
    case 2: return "HIGH_IMPACT_ONLY";
    case 3: return "STRUCTURE_REPAIR";
    case 6:
    case 8:
    case 10: return "FULL_REWRITE_CONSTRAINED";
    default: return "FORK_CONSERVATIVE_AGGRESSIVE"; // 4, 5, 7, 9, 11+
  }
}

/**
 * Select notes based on strategy.
 */
export function selectNotesForStrategy(
  strategy: AttemptStrategy,
  allNotes: { blocking_issues?: any[]; high_impact_notes?: any[]; polish_notes?: any[] },
): { approvedNotes: any[]; globalDirections: string[] } {
  const blockers = allNotes.blocking_issues || [];
  const highImpact = allNotes.high_impact_notes || [];

  switch (strategy) {
    case "TARGETED_BLOCKERS":
      return { approvedNotes: blockers, globalDirections: [] };

    case "HIGH_IMPACT_ONLY":
      return { approvedNotes: [...blockers, ...highImpact], globalDirections: [] };

    case "STRUCTURE_REPAIR":
      return {
        approvedNotes: [...blockers, ...highImpact],
        globalDirections: [
          "Focus on structural coherence: scene order, act breaks, narrative throughlines.",
          "Ensure each scene has a clear purpose and connects to the overall arc.",
          "Fix pacing issues and structural gaps before refining prose.",
        ],
      };

    case "FULL_REWRITE_CONSTRAINED":
      return {
        approvedNotes: [...blockers, ...highImpact],
        globalDirections: [
          "Full rewrite permitted but constrained: preserve all character names, key plot points, and established world-building.",
          "Maintain the original voice and tone while addressing all structural and quality issues.",
          "Do not introduce new characters or subplot threads not already established.",
          "Every scene must serve the primary dramatic question.",
        ],
      };

    case "FORK_CONSERVATIVE_AGGRESSIVE":
      // Caller handles fork logic — return base notes
      return { approvedNotes: [...blockers, ...highImpact], globalDirections: [] };
  }
}

/**
 * Get globalDirections for fork candidates.
 */
export function getForkDirections(): { conservative: string[]; aggressive: string[] } {
  return {
    conservative: [
      "CONSERVATIVE approach: Make minimal changes to preserve the existing voice and structure.",
      "Only modify what is strictly necessary to resolve blocking issues.",
      "Preserve existing scene order, character dynamics, and tonal register.",
    ],
    aggressive: [
      "AGGRESSIVE approach: Structural re-ordering is allowed to improve pacing and dramatic impact.",
      "You may resequence scenes, merge or split beats, and restructure act breaks.",
      "Must still satisfy all protect items and preserve core narrative intent.",
      "Prioritize dramatic effectiveness over preserving the current arrangement.",
    ],
  };
}

// selectBestCandidate removed — fork winner selection is inline in auto-run for correctness
