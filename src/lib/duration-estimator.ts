/**
 * Deterministic Duration Estimator
 * 
 * Single source of truth for estimating script duration from text.
 * Used across scoring, stale/criteria validation, and rewrite guidance.
 * 
 * Heuristics:
 * - Dialogue lines (starting with character cue): ~2.5 words/sec (150 wpm)
 * - Action/description lines: ~1.5 words/sec (90 wpm — visual pacing)
 * - Parentheticals/sluglines: fixed 2s each
 * - Empty lines: 0.5s (beat/pause)
 */

const DIALOGUE_WPS = 2.5;       // words per second for dialogue
const ACTION_WPS = 1.5;         // words per second for action lines
const SLUGLINE_DURATION = 2;    // seconds per slugline
const PARENTHETICAL_DURATION = 1; // seconds per parenthetical
const BEAT_PAUSE = 0.5;         // seconds per empty line (scene beat)

// Matches uppercase character cue: "JOHN:", "NARRATOR (V.O.):", etc.
const DIALOGUE_CUE_RE = /^[A-Z][A-Z\s.'()-]{1,40}[:]\s*/;
const SLUGLINE_RE = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)\s/i;
const PARENTHETICAL_RE = /^\s*\(.*\)\s*$/;

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Estimate duration in seconds from document text.
 * Deterministic: same input → same output, always.
 */
export function estimateDurationSeconds(documentText: string): number {
  if (!documentText || documentText.trim().length === 0) return 0;

  const lines = documentText.split('\n');
  let totalSeconds = 0;
  let inDialogue = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      totalSeconds += BEAT_PAUSE;
      inDialogue = false;
      continue;
    }

    if (SLUGLINE_RE.test(trimmed)) {
      totalSeconds += SLUGLINE_DURATION;
      inDialogue = false;
      continue;
    }

    if (PARENTHETICAL_RE.test(trimmed)) {
      totalSeconds += PARENTHETICAL_DURATION;
      continue;
    }

    if (DIALOGUE_CUE_RE.test(trimmed)) {
      // Character cue line — the dialogue follows
      inDialogue = true;
      // The cue itself takes ~1s
      totalSeconds += 1;
      // Any text after the colon on the same line is dialogue
      const afterCue = trimmed.replace(DIALOGUE_CUE_RE, '').trim();
      if (afterCue.length > 0) {
        totalSeconds += countWords(afterCue) / DIALOGUE_WPS;
      }
      continue;
    }

    // Regular content line
    const words = countWords(trimmed);
    if (inDialogue) {
      totalSeconds += words / DIALOGUE_WPS;
    } else {
      totalSeconds += words / ACTION_WPS;
    }
  }

  return Math.round(totalSeconds);
}

/**
 * Check if measured duration meets target range.
 * Returns delta (positive = over, negative = under).
 */
export function checkDurationMeetsTarget(
  measuredSeconds: number,
  targetMin: number | null | undefined,
  targetMax: number | null | undefined,
  targetScalar: number | null | undefined,
): { meets: boolean; delta: number; targetUsed: { min: number; max: number } } {
  const min = targetMin ?? targetScalar ?? 0;
  const max = targetMax ?? targetScalar ?? Infinity;
  
  if (min === 0 && max === Infinity) {
    return { meets: true, delta: 0, targetUsed: { min: 0, max: 0 } };
  }
  
  // Allow 10% tolerance on each side
  const toleranceMin = Math.floor(min * 0.9);
  const toleranceMax = Math.ceil(max * 1.1);
  
  const meets = measuredSeconds >= toleranceMin && measuredSeconds <= toleranceMax;
  const midpoint = Math.round((min + max) / 2);
  const delta = measuredSeconds - midpoint;
  
  return { meets, delta, targetUsed: { min, max } };
}

/**
 * Compute a stable hash for criteria, for provenance comparison.
 */
export function computeCriteriaHash(criteria: Record<string, any>): string {
  const sorted = Object.keys(criteria)
    .filter(k => criteria[k] != null && k !== 'updated_at')
    .sort()
    .map(k => `${k}=${JSON.stringify(criteria[k])}`)
    .join('|');
  // Simple deterministic hash (djb2)
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash + sorted.charCodeAt(i)) & 0xffffffff;
  }
  return `ch_${(hash >>> 0).toString(36)}`;
}

/**
 * Classify criteria comparison result.
 */
export type CriteriaClassification = 
  | 'OK'
  | 'CRITERIA_STALE_PROVENANCE'
  | 'CRITERIA_FAIL_DURATION';

export function classifyCriteria(opts: {
  versionCriteriaHash: string | null | undefined;
  currentCriteriaHash: string | null | undefined;
  measuredDurationSeconds: number;
  targetDurationMin: number | null | undefined;
  targetDurationMax: number | null | undefined;
  targetDurationScalar: number | null | undefined;
}): { classification: CriteriaClassification; detail: string } {
  // 1. Check provenance (hash mismatch = criteria actually changed)
  if (opts.versionCriteriaHash && opts.currentCriteriaHash
      && opts.versionCriteriaHash !== opts.currentCriteriaHash) {
    return {
      classification: 'CRITERIA_STALE_PROVENANCE',
      detail: `Version criteria hash ${opts.versionCriteriaHash} differs from current ${opts.currentCriteriaHash}`,
    };
  }

  // 2. Check duration (hash matches or missing = check measured vs target)
  const { meets, delta, targetUsed } = checkDurationMeetsTarget(
    opts.measuredDurationSeconds,
    opts.targetDurationMin,
    opts.targetDurationMax,
    opts.targetDurationScalar,
  );

  if (!meets && (targetUsed.min > 0 || targetUsed.max > 0)) {
    return {
      classification: 'CRITERIA_FAIL_DURATION',
      detail: `Duration ${opts.measuredDurationSeconds}s vs target ${targetUsed.min}-${targetUsed.max}s (delta: ${delta > 0 ? '+' : ''}${delta}s)`,
    };
  }

  return { classification: 'OK', detail: 'Criteria met' };
}
