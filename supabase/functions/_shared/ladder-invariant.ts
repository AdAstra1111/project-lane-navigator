/**
 * Ladder Promotion Invariant Guard — shared backend utility.
 *
 * Prevents: promotion loops, reverse promotion, silent stage drift,
 * invalid next-stage computation, duplicate ladder entries.
 *
 * This is the single canonical pattern for any surface that computes
 * stage progression. All promotion logic MUST use this guard.
 */

export interface LadderContext {
  format: string;
  source: string;
}

/**
 * Validates that a ladder is structurally sound:
 * - non-empty array
 * - all entries are non-empty strings
 * - no duplicate entries
 *
 * Throws on any violation — fail-closed.
 */
export function assertValidLadder(
  ladder: string[],
  context: LadderContext,
): void {
  if (!Array.isArray(ladder) || ladder.length === 0) {
    throw new Error(
      `[ladder-invariant] missing_or_empty_ladder format=${context.format} source=${context.source}`,
    );
  }

  const seen = new Set<string>();
  for (const stage of ladder) {
    if (!stage || typeof stage !== "string") {
      throw new Error(
        `[ladder-invariant] invalid_stage_value format=${context.format} source=${context.source} stage=${String(stage)}`,
      );
    }
    if (seen.has(stage)) {
      throw new Error(
        `[ladder-invariant] duplicate_stage format=${context.format} source=${context.source} stage=${stage}`,
      );
    }
    seen.add(stage);
  }
}

/**
 * Returns the next canonical stage given a ladder and current stage.
 *
 * Returns null if:
 * - currentStage is not in the ladder (unresolved — logged as error)
 * - currentStage is the last stage (end of ladder)
 *
 * Throws if:
 * - ladder is invalid (via assertValidLadder)
 * - next stage is somehow the same as current (self-loop)
 * - next stage index is not strictly forward (non-forward progression)
 */
export function getCanonicalNextStage(params: {
  ladder: string[];
  currentStage: string;
  format: string;
  source: string;
}): string | null {
  const { ladder, currentStage, format, source } = params;

  assertValidLadder(ladder, { format, source });

  const idx = ladder.indexOf(currentStage);

  if (idx === -1) {
    console.error(
      `[ladder-invariant] unresolved_stage format=${format} source=${source} currentStage=${currentStage} ladder=${JSON.stringify(ladder)}`,
    );
    return null;
  }

  if (idx >= ladder.length - 1) {
    return null; // end of ladder — no next stage
  }

  const nextStage = ladder[idx + 1];

  if (!nextStage) {
    throw new Error(
      `[ladder-invariant] missing_next_stage format=${format} source=${source} currentStage=${currentStage} idx=${idx}`,
    );
  }

  if (nextStage === currentStage) {
    throw new Error(
      `[ladder-invariant] self_loop format=${format} source=${source} currentStage=${currentStage}`,
    );
  }

  const nextIdx = ladder.indexOf(nextStage);
  if (nextIdx <= idx) {
    throw new Error(
      `[ladder-invariant] non_forward_progression format=${format} source=${source} currentStage=${currentStage} nextStage=${nextStage} idx=${idx} nextIdx=${nextIdx}`,
    );
  }

  return nextStage;
}

/**
 * Feature-film specific order assertion.
 * Validates that the critical stages appear in the correct canonical order.
 * Use in tests or startup validation.
 */
export function assertFeatureFilmOrder(ladder: string[]): void {
  const stages = [
    "treatment",
    "story_outline",
    "character_bible",
    "beat_sheet",
    "feature_script",
    "production_draft",
  ] as const;

  const indices = stages.map((s) => {
    const idx = ladder.indexOf(s);
    if (idx === -1) {
      throw new Error(
        `[ladder-invariant] feature-film ladder missing stage: ${s}`,
      );
    }
    return idx;
  });

  for (let i = 0; i < indices.length - 1; i++) {
    if (!(indices[i] < indices[i + 1])) {
      throw new Error(
        `[ladder-invariant] feature-film order invalid: ${stages[i]} (idx=${indices[i]}) must precede ${stages[i + 1]} (idx=${indices[i + 1]})`,
      );
    }
  }
}
