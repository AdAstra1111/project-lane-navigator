/**
 * scriptCanon — Lane-based primary script doc type resolver.
 *
 * Determines the correct primary script doc_type based on assigned_lane.
 * No database lookups. Pure deterministic logic.
 *
 * Rules:
 *   vertical_drama → season_script  (full-season continuous script)
 *   series         → episode_script (per-episode scripts)
 *   all others     → season_script  (single script document)
 */

export function resolvePrimaryScriptDocType(
  assignedLane?: string | null,
): 'season_script' | 'episode_script' {
  if (assignedLane === 'series') return 'episode_script';
  return 'season_script';
}

export function primaryScriptLabel(
  assignedLane?: string | null,
): string {
  return assignedLane === 'series' ? 'Episode Script' : 'Season Script';
}
