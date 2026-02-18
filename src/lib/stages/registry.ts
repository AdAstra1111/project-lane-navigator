/**
 * CANONICAL STAGE REGISTRY — Single source of truth for deliverable stage ordering.
 *
 * Used by:
 *  - Dev Engine UI (DeliverablePipeline, usePromotionIntelligence)
 *  - AutoRun hooks (useAutoRun, useAutoRunMissionControl)
 *  - Edge functions import the equivalent FORMAT_LADDERS directly (Deno cannot import from src/)
 *    but MUST be kept in sync with this file manually.
 *
 * SYNC POINT: supabase/functions/auto-run/index.ts  → FORMAT_LADDERS
 *             supabase/functions/dev-engine-v2/index.ts → FORMAT_LADDERS
 */

export type DeliverableStage =
  | 'idea'
  | 'topline_narrative'
  | 'concept_brief'
  | 'market_sheet'
  | 'vertical_market_sheet'
  | 'blueprint'
  | 'architecture'
  | 'character_bible'
  | 'beat_sheet'
  | 'script'
  | 'production_draft'
  | 'deck'
  | 'documentary_outline'
  | 'format_rules'
  | 'season_arc'
  | 'episode_grid'
  | 'vertical_episode_beats'
  | 'series_writer';

// ── Per-format ordered ladders ────────────────────────────────────────────────
// These are the authoritative ordered lists. Auto-run and dev-engine-v2 edge
// functions MUST mirror these exactly.
export const FORMAT_LADDERS: Record<string, DeliverableStage[]> = {
  'film': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'architecture', 'character_bible', 'beat_sheet',
    'script', 'production_draft', 'deck',
  ],
  'feature': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'architecture', 'character_bible', 'beat_sheet',
    'script', 'production_draft', 'deck',
  ],
  'tv-series': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'architecture', 'character_bible', 'beat_sheet',
    'script', 'production_draft',
  ],
  'limited-series': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'architecture', 'character_bible', 'beat_sheet',
    'script', 'production_draft',
  ],
  'digital-series': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'architecture', 'character_bible', 'beat_sheet',
    'script', 'production_draft',
  ],
  'vertical-drama': [
    'idea', 'topline_narrative', 'concept_brief', 'vertical_market_sheet',
    'format_rules', 'character_bible', 'season_arc', 'episode_grid',
    'vertical_episode_beats', 'script',
  ],
  'documentary': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'documentary_outline', 'deck',
  ],
  'documentary-series': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'documentary_outline', 'deck',
  ],
  'hybrid-documentary': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'documentary_outline', 'blueprint', 'deck',
  ],
  'short': [
    'idea', 'topline_narrative', 'concept_brief', 'script',
  ],
  'animation': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'character_bible', 'beat_sheet', 'script',
  ],
  'anim-series': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'architecture', 'character_bible', 'beat_sheet',
    'script', 'production_draft',
  ],
  'reality': [
    'idea', 'topline_narrative', 'concept_brief', 'market_sheet',
    'blueprint', 'beat_sheet', 'script',
  ],
};

// Default fallback (scripted film)
export const STAGE_ORDER_DEFAULT: DeliverableStage[] = FORMAT_LADDERS['film'];

/** Normalize a format string to the registry key */
export function normalizeFormatKey(format: string): string {
  return (format || 'film').toLowerCase().replace(/[_ ]+/g, '-');
}

/** Get the ordered ladder for a given project format */
export function getLadderForFormat(format: string): DeliverableStage[] {
  const key = normalizeFormatKey(format);
  return FORMAT_LADDERS[key] ?? FORMAT_LADDERS['film'];
}

/** Get the 0-based index of a stage in the ladder, or -1 if not present */
export function getStageIndex(stage: string, format: string): number {
  return getLadderForFormat(format).indexOf(stage as DeliverableStage);
}

/** Is this stage on the ladder for this format? */
export function isStageApplicable(stage: string, format: string): boolean {
  return getStageIndex(stage, format) >= 0;
}

/**
 * Get the next stage after currentStage for the given format.
 * Returns null if currentStage is last or not on the ladder.
 */
export function getNextStage(currentStage: string, format: string): DeliverableStage | null {
  const ladder = getLadderForFormat(format);
  const idx = ladder.indexOf(currentStage as DeliverableStage);
  if (idx < 0 || idx >= ladder.length - 1) return null;
  return ladder[idx + 1];
}

/**
 * Get the previous stage before currentStage for the given format.
 */
export function getPrevStage(currentStage: string, format: string): DeliverableStage | null {
  const ladder = getLadderForFormat(format);
  const idx = ladder.indexOf(currentStage as DeliverableStage);
  if (idx <= 0) return null;
  return ladder[idx - 1];
}

/**
 * Map a raw doc_type (which may be a UI label or variant name) to the
 * canonical stage name on the ladder.  Used by AutoRun hooks before calling
 * the edge function.
 */
export const DOC_TYPE_TO_LADDER_STAGE: Record<string, DeliverableStage> = {
  // Direct matches
  idea:                    'idea',
  topline_narrative:       'topline_narrative',
  concept_brief:           'concept_brief',
  market_sheet:            'market_sheet',
  vertical_market_sheet:   'vertical_market_sheet',
  blueprint:               'blueprint',
  architecture:            'architecture',
  character_bible:         'character_bible',
  beat_sheet:              'beat_sheet',
  script:                  'script',
  production_draft:        'production_draft',
  deck:                    'deck',
  documentary_outline:     'documentary_outline',
  format_rules:            'format_rules',
  season_arc:              'season_arc',
  episode_grid:            'episode_grid',
  vertical_episode_beats:  'vertical_episode_beats',
  series_writer:           'series_writer',
  // Aliases
  logline:                 'idea',
  one_pager:               'concept_brief',
  treatment:               'blueprint',
  season_outline:          'blueprint',
  outline:                 'blueprint',
  episode_beat_sheet:      'beat_sheet',
  feature_script:          'script',
  pilot_script:            'script',
  episode_script:          'script',
  episode_1_script:        'script',
  writers_room:            'series_writer',
  notes:                   'concept_brief',
  // AutoRun legacy
  draft:                   'script',
  coverage:                'production_draft',
};

export function mapDocTypeToLadderStage(docType: string): DeliverableStage {
  const key = docType.toLowerCase().replace(/[-\s]+/g, '_');
  return DOC_TYPE_TO_LADDER_STAGE[key] ?? 'idea';
}

// ── Self-test (call in dev to verify consistency) ────────────────────────────
export function runStageRegistrySelfTest(verbose = false): { passed: boolean; failures: string[] } {
  const failures: string[] = [];

  // 1. Every ladder must start with 'idea'
  for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
    if (ladder[0] !== 'idea') {
      failures.push(`Format "${fmt}": ladder does not start with 'idea' (got "${ladder[0]}")`);
    }
  }

  // 2. No duplicates within a ladder
  for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
    const seen = new Set<string>();
    for (const stage of ladder) {
      if (seen.has(stage)) failures.push(`Format "${fmt}": duplicate stage "${stage}"`);
      seen.add(stage);
    }
  }

  // 3. 'draft' must NOT appear in any ladder (legacy alias — use 'script' instead)
  for (const [fmt, ladder] of Object.entries(FORMAT_LADDERS)) {
    if ((ladder as string[]).includes('draft')) {
      failures.push(`Format "${fmt}": ladder contains legacy "draft" — replace with "script" or "production_draft"`);
    }
  }

  // 4. getNextStage consistency
  const filmLadder = FORMAT_LADDERS['film'];
  for (let i = 0; i < filmLadder.length - 1; i++) {
    const got = getNextStage(filmLadder[i], 'film');
    const expected = filmLadder[i + 1];
    if (got !== expected) {
      failures.push(`getNextStage("${filmLadder[i]}", "film"): expected "${expected}", got "${got}"`);
    }
  }

  if (verbose) {
    if (failures.length === 0) {
      console.log('[StageRegistry] ✅ All self-tests passed');
    } else {
      console.error('[StageRegistry] ❌ Failures:', failures);
    }
  }

  return { passed: failures.length === 0, failures };
}
