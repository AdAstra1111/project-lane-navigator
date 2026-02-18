/**
 * CANONICAL STAGE REGISTRY — Single source of truth for deliverable stage ordering.
 *
 * Data source: supabase/_shared/stage-ladders.json  (shared with the auto-run edge function)
 *
 * Used by:
 *  - Dev Engine UI (DeliverablePipeline, usePromotionIntelligence)
 *  - AutoRun hooks (useAutoRun, useAutoRunMissionControl)
 *  - StagePlanPanel (verification UI)
 *  - The edge function reads stage-ladders.json directly (Deno cannot import from src/)
 *
 * DRIFT-PROOF: Both frontend and backend read the SAME JSON.
 * The JSON is the authority; this file is a typed wrapper.
 */

// ── Import the shared JSON ─────────────────────────────────────────────────────
import LADDERS_JSON from '../../../supabase/_shared/stage-ladders.json';

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
  | 'season_master_script'
  | 'production_draft'
  | 'deck'
  | 'documentary_outline'
  | 'format_rules'
  | 'season_arc'
  | 'episode_grid'
  | 'vertical_episode_beats'
  | 'series_writer';

// ── Per-format ordered ladders (loaded from shared JSON) ─────────────────────
export const FORMAT_LADDERS: Record<string, DeliverableStage[]> =
  LADDERS_JSON.FORMAT_LADDERS as Record<string, DeliverableStage[]>;

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
 * Given a list of existing doc types for a project, return the nearest
 * canonical stage that exists, walking backwards from currentStage.
 * Used as fallback when currentStage is not on the ladder.
 */
export function getNearestExistingStage(
  currentStage: string,
  format: string,
  existingDocTypes: string[]
): DeliverableStage | null {
  const ladder = getLadderForFormat(format);
  const idx = ladder.indexOf(currentStage as DeliverableStage);
  const start = idx >= 0 ? idx : ladder.length - 1;
  for (let i = start; i >= 0; i--) {
    if (existingDocTypes.includes(ladder[i])) return ladder[i];
  }
  return null;
}

/**
 * Map a raw doc_type (which may be a UI label or variant name) to the
 * canonical stage name on the ladder.  Used by AutoRun hooks before calling
 * the edge function.
 *
 * IMPORTANT: "draft" → "script" and "coverage" → "production_draft".
 * Neither "draft" nor "coverage" are real stage doc_types.
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
  season_master_script:    'season_master_script',
  production_draft:        'production_draft',
  deck:                    'deck',
  documentary_outline:     'documentary_outline',
  format_rules:            'format_rules',
  season_arc:              'season_arc',
  episode_grid:            'episode_grid',
  vertical_episode_beats:  'vertical_episode_beats',
  series_writer:           'series_writer',
  // Aliases (from shared JSON)
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
  // Legacy aliases — NEVER stored as real doc_types
  draft:                   'script',
  coverage:                'production_draft',
  complete_season_script:  'season_master_script',
};

export function mapDocTypeToLadderStage(docType: string): DeliverableStage {
  const key = (docType || '').toLowerCase().replace(/[-\s]+/g, '_');
  return DOC_TYPE_TO_LADDER_STAGE[key] ?? 'idea';
}

/**
 * Sanitize a doc_type before storing it to the database.
 * Maps legacy aliases to canonical stages so "draft" is never persisted.
 */
export function sanitizeDocType(docType: string): DeliverableStage {
  const mapped = mapDocTypeToLadderStage(docType);
  // Extra guard: if the mapped result is still an alias that snuck through, default to 'script'
  if (mapped === 'idea' && docType !== 'idea' && docType !== 'logline') {
    return 'concept_brief'; // safe fallback
  }
  return mapped;
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
    if ((ladder as string[]).includes('coverage')) {
      failures.push(`Format "${fmt}": ladder contains legacy "coverage" — replace with "production_draft"`);
    }
  }

  // 4. getNextStage consistency for film
  const filmLadder = FORMAT_LADDERS['film'];
  for (let i = 0; i < filmLadder.length - 1; i++) {
    const got = getNextStage(filmLadder[i], 'film');
    const expected = filmLadder[i + 1];
    if (got !== expected) {
      failures.push(`getNextStage("${filmLadder[i]}", "film"): expected "${expected}", got "${got}"`);
    }
  }

  // 5. getNextStage consistency for vertical-drama
  const vdLadder = FORMAT_LADDERS['vertical-drama'];
  for (let i = 0; i < vdLadder.length - 1; i++) {
    const got = getNextStage(vdLadder[i], 'vertical-drama');
    const expected = vdLadder[i + 1];
    if (got !== expected) {
      failures.push(`getNextStage("${vdLadder[i]}", "vertical-drama"): expected "${expected}", got "${got}"`);
    }
  }

  // 6. mapDocTypeToLadderStage('draft') must return 'script', never 'draft'
  const draftMapped = mapDocTypeToLadderStage('draft');
  if (draftMapped !== 'script') {
    failures.push(`mapDocTypeToLadderStage("draft") returned "${draftMapped}", expected "script"`);
  }

  // 7. FORMAT_LADDERS matches the JSON source
  const jsonLadders = LADDERS_JSON.FORMAT_LADDERS as Record<string, string[]>;
  for (const [fmt, ladder] of Object.entries(jsonLadders)) {
    const registered = FORMAT_LADDERS[fmt];
    if (!registered) {
      failures.push(`JSON has format "${fmt}" but FORMAT_LADDERS does not`);
      continue;
    }
    if (JSON.stringify(registered) !== JSON.stringify(ladder)) {
      failures.push(`FORMAT_LADDERS["${fmt}"] diverged from JSON source`);
    }
  }

  if (verbose) {
    if (failures.length === 0) {
      console.log('[StageRegistry] ✅ All self-tests passed');
      console.log('[StageRegistry] Ladder counts:', Object.fromEntries(
        Object.entries(FORMAT_LADDERS).map(([k, v]) => [k, v.length])
      ));
    } else {
      console.error('[StageRegistry] ❌ Failures:', failures);
    }
  }

  return { passed: failures.length === 0, failures };
}
