/**
 * Canonical Episode Duration Resolver — single source of truth for client-side.
 *
 * Resolution order:
 *   1. canon_json.format.episode_duration_seconds (highest priority)
 *   2. canon_json legacy keys (episode_length_seconds_min/max)
 *   3. lanePrefs.duration_rule (if any)
 *   4. Lane default heuristic
 *   5. Fallback safe default (only if nothing else)
 *
 * If locked === true, no stage may override.
 */

import { FORMAT_DEFAULTS, normalizeFormat } from '@/lib/qualifications/resolveQualifications';

export interface ResolvedDuration {
  minSec: number | null;
  maxSec: number | null;
  source: 'user' | 'devseed' | 'canon_legacy' | 'lane_prefs' | 'lane_default' | 'fallback';
  locked: boolean;
}

export function resolveEpisodeDuration({
  canonJson,
  lanePrefs,
  lane,
}: {
  canonJson?: Record<string, any> | null;
  lanePrefs?: Record<string, any> | null;
  lane?: string | null;
}): ResolvedDuration {
  // Priority 1: canon_json.format block (new canonical model)
  const fmtBlock = canonJson?.format;
  if (fmtBlock?.episode_duration_seconds) {
    const eds = fmtBlock.episode_duration_seconds;
    const min = typeof eds.min === 'number' ? eds.min : null;
    const max = typeof eds.max === 'number' ? eds.max : null;
    if (min != null || max != null) {
      return {
        minSec: min,
        maxSec: max,
        source: (fmtBlock.episode_duration_source as any) || 'user',
        locked: !!fmtBlock.episode_duration_locked,
      };
    }
  }

  // Priority 2: Legacy canon_json keys
  const legMin = typeof canonJson?.episode_length_seconds_min === 'number' ? canonJson.episode_length_seconds_min : null;
  const legMax = typeof canonJson?.episode_length_seconds_max === 'number' ? canonJson.episode_length_seconds_max : null;
  if (legMin != null || legMax != null) {
    return {
      minSec: legMin,
      maxSec: legMax,
      source: 'canon_legacy',
      locked: false,
    };
  }

  // Priority 3: Lane prefs
  if (lanePrefs?.duration_rule) {
    const dr = lanePrefs.duration_rule;
    if (typeof dr.min === 'number' || typeof dr.max === 'number') {
      return {
        minSec: dr.min ?? null,
        maxSec: dr.max ?? null,
        source: 'lane_prefs',
        locked: false,
      };
    }
  }

  // Priority 4: Lane default from FORMAT_DEFAULTS
  if (lane) {
    const fmt = normalizeFormat(lane);
    const defaults = FORMAT_DEFAULTS[fmt];
    if (defaults?.episode_target_duration_min_seconds || defaults?.episode_target_duration_max_seconds) {
      return {
        minSec: defaults.episode_target_duration_min_seconds ?? null,
        maxSec: defaults.episode_target_duration_max_seconds ?? null,
        source: 'lane_default',
        locked: false,
      };
    }
  }

  // Priority 5: Fallback
  return { minSec: null, maxSec: null, source: 'fallback', locked: false };
}

/**
 * Format duration for display: "2–3 min" or "45–90s"
 */
export function formatDurationDisplay(minSec: number | null, maxSec: number | null): string {
  if (minSec == null && maxSec == null) return 'Not set';
  const min = minSec ?? maxSec!;
  const max = maxSec ?? minSec!;
  if (min >= 60 && max >= 60 && min % 60 === 0 && max % 60 === 0) {
    return min === max ? `${min / 60} min` : `${min / 60}–${max / 60} min`;
  }
  return min === max ? `${min}s` : `${min}–${max}s`;
}
