/**
 * Auto-Run execution mode configuration.
 * 'full' = traverse entire ladder from start to target (current behavior).
 * 'staged' = stop after each stage for review.
 * No schema changes — purely a client-side constant.
 */
export const AUTO_RUN_EXECUTION_MODE: 'full' | 'staged' = 'full';

export const EXECUTION_MODE_LABEL: Record<string, string> = {
  full: 'Full Ladder',
  staged: 'Staged Ladder',
};
