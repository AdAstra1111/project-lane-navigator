/**
 * Canonical Beat Definition & Beat Target Computation for Vertical Drama.
 * Single source of truth — imported by all edge functions that reference beats.
 */

// ── Canonical Beat Definition ──

export const BEAT_DEFINITION_TEXT = `BEAT = a distinct moment of story change (new information, decision, reversal, escalation, or emotional shift) that creates forward motion. In vertical drama, beats are micro-turns designed to maintain scroll-stopping momentum: each beat should either (1) raise stakes, (2) reveal new information, (3) force a choice, or (4) flip an emotional state. A beat is NOT a line of dialogue; it is a change in the situation.

VERTICAL DRAMA BEAT GUIDANCE:
- Hook beat within first 3–10 seconds.
- Micro-cliffhanger at end of every episode.
- Avoid dead air: ensure continuous beat cadence throughout.`;

// ── Beat Target Computation ──

export interface BeatTargetInput {
  minSeconds: number;
  maxSeconds: number;
  midSeconds?: number;
}

export interface BeatTargets {
  beatCountMin: number;
  beatCountMax: number;
  beatCountRange: string;
  beatSpacingTargetSeconds: number;
  beatSpacingLabel: string;
  hookWindowSeconds: [number, number];
  midSeconds: number;
  durationRangeLabel: string;
  summaryText: string;
}

export function computeBeatTargets(input: BeatTargetInput): BeatTargets {
  const { minSeconds, maxSeconds } = input;
  const midSeconds = input.midSeconds ?? Math.round((minSeconds + maxSeconds) / 2);

  const hookWindowSeconds: [number, number] = [3, 10];

  // Target beat spacing: clamp(mid/10, 6, 18) — keeps cadence tight for short eps, relaxed for longer
  const beatSpacingTargetSeconds = Math.max(6, Math.min(18, Math.round(midSeconds / 10)));

  const beatCountMin = Math.max(2, Math.floor(minSeconds / beatSpacingTargetSeconds));
  const beatCountMax = Math.max(beatCountMin, Math.ceil(maxSeconds / beatSpacingTargetSeconds));

  const beatCountRange = beatCountMin === beatCountMax
    ? `${beatCountMin} beats`
    : `${beatCountMin}–${beatCountMax} beats`;

  const beatSpacingLabel = `~${beatSpacingTargetSeconds}s per beat`;

  const durationRangeLabel = minSeconds === maxSeconds
    ? `${minSeconds}s`
    : `${minSeconds}–${maxSeconds}s`;

  const summaryText = `Target beat count: ${beatCountRange} across ${durationRangeLabel} (aim ${beatSpacingLabel}). Hook within ${hookWindowSeconds[0]}–${hookWindowSeconds[1]}s. Micro-cliffhanger required at end.`;

  return {
    beatCountMin,
    beatCountMax,
    beatCountRange,
    beatSpacingTargetSeconds,
    beatSpacingLabel,
    hookWindowSeconds,
    midSeconds,
    durationRangeLabel,
    summaryText,
  };
}

/**
 * Minimum beat count for a given duration (scalar fallback).
 * Mirrors the client-side verticalBeatMinimum in dev-os-config.ts.
 */
export function verticalBeatMinimumServer(durationSeconds: number): number {
  if (durationSeconds <= 90) return 3;
  if (durationSeconds <= 120) return 4;
  if (durationSeconds <= 150) return 5;
  if (durationSeconds <= 180) return 6;
  return 7;
}

/**
 * Build a prompt block that includes the beat definition + range-aware targets.
 * Inject this into any system prompt that references beats.
 */
export function buildBeatGuidanceBlock(
  minSeconds?: number | null,
  maxSeconds?: number | null,
  scalarSeconds?: number | null,
): string {
  const min = minSeconds || scalarSeconds || null;
  const max = maxSeconds || scalarSeconds || null;

  if (!min && !max) {
    return `
BEAT DEFINITION:
${BEAT_DEFINITION_TEXT}`;
  }

  const effectiveMin = min || max!;
  const effectiveMax = max || min!;
  const targets = computeBeatTargets({ minSeconds: effectiveMin, maxSeconds: effectiveMax });

  return `
BEAT DEFINITION:
${BEAT_DEFINITION_TEXT}

BEAT CADENCE TARGETS:
${targets.summaryText}`;
}
