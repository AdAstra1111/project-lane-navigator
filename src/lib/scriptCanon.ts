/**
 * scriptCanon — Lane-based primary script doc type resolver.
 *
 * Determines the correct primary script doc_type based on assigned_lane.
 * No database lookups. Pure deterministic logic.
 *
 * Rules:
 *   vertical_drama → season_script  (full-season continuous script)
 *   series         → episode_script (per-episode scripts)
 *   feature_film   → feature_script (single feature screenplay)
 *   animation      → feature_script
 *   short          → feature_script
 *   documentary    → feature_script
 *   all others     → feature_script (default to single screenplay)
 */

export function resolvePrimaryScriptDocType(
  assignedLane?: string | null,
): 'season_script' | 'episode_script' | 'feature_script' {
  if (assignedLane === 'series') return 'episode_script';
  if (assignedLane === 'vertical_drama') return 'season_script';
  return 'feature_script';
}

export function primaryScriptLabel(
  assignedLane?: string | null,
): string {
  if (assignedLane === 'series') return 'Episode Script';
  if (assignedLane === 'vertical_drama') return 'Season Script';
  return 'Feature Script';
}
