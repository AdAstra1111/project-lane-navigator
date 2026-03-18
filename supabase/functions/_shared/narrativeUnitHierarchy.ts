/**
 * NARRATIVE UNIT EXECUTION HIERARCHY — Governing Architecture Rule
 *
 * IFFY must always use the smallest stable narrative unit available for the deliverable.
 *
 * ═══════════════════════════════════════════════════════════════════
 * 1. EPISODE-INDEXED DOCS
 *    Docs: episode_grid, episode_beats, vertical_episode_beats,
 *          season_script, season_master_script
 *    Execution unit = 1 episode
 *    - compute affected episode indices
 *    - rewrite only affected episodes
 *    - preserve unaffected episodes exactly
 *    - reassemble full deliverable from preserved + rewritten units
 *    No multi-episode batch is the default execution unit.
 *
 * 2. FEATURE / SINGLE-SCRIPT DOCS
 *    Docs: feature_script, production_draft, other scene-structured scripts
 *    Execution unit = 1 scene
 *    - compute affected scene indices
 *    - rewrite only affected scenes
 *    - preserve unaffected scenes exactly
 *    - reassemble full script from preserved + rewritten scene units
 *
 * 3. LONG-FORM SERIES SCRIPTING (NORTH STAR)
 *    For long-form episodic series scripts:
 *      outer unit = episode
 *      inner unit = scene
 *    - first compute affected episodes
 *    - within each affected episode, compute affected scenes
 *    - rewrite only affected scenes inside affected episodes
 *    - preserve untouched scenes within affected episodes
 *    - preserve untouched episodes outside affected set
 *    - reassemble episode → reassemble season/series script
 *
 * 4. UI / OPERATOR TRUTH
 *    Progress must reflect the true unit model:
 *    - episode-by-episode for episode-indexed docs
 *    - scene-by-scene for scene-indexed docs
 *    - episode → scene nested for long-form series
 *    Never surface generic "chunk" when a narrative unit is known.
 *
 * 5. PRESERVATION RULE
 *    Unaffected narrative units remain unchanged by default.
 *    Broad whole-document regeneration only when explicitly requested.
 *
 * 6. COMPLETION GATE
 *    Promotion to authoritative/latest/current only when all required
 *    narrative units are present and validated for the deliverable contract.
 * ═══════════════════════════════════════════════════════════════════
 */

export type NarrativeUnitType = 'episode' | 'scene' | 'section';

export interface NarrativeUnitModel {
  outerUnit: NarrativeUnitType;
  innerUnit?: NarrativeUnitType;
  nested: boolean;
}

// ── Episode-indexed doc types: execution unit = 1 episode ──

const EPISODE_UNIT_DOC_TYPES = new Set([
  'episode_grid',
  'episode_beats',
  'vertical_episode_beats',
  'season_script',
  'season_master_script',
  'season_scripts_bundle',
  'episode_script',
]);

// ── Scene-indexed doc types: execution unit = 1 scene ──

const SCENE_UNIT_DOC_TYPES = new Set([
  'feature_script',
  'production_draft',
]);

/**
 * Returns the canonical narrative unit model for a doc type.
 * This is the AUTHORITATIVE source for execution granularity decisions.
 */
export function unitModelFor(docType: string): NarrativeUnitModel {
  if (EPISODE_UNIT_DOC_TYPES.has(docType)) {
    return { outerUnit: 'episode', nested: false };
  }
  if (SCENE_UNIT_DOC_TYPES.has(docType)) {
    return { outerUnit: 'scene', nested: false };
  }
  // Default: section-based (acts, thematic sections)
  return { outerUnit: 'section', nested: false };
}

/**
 * North-star model for long-form series scripting (episode → scene nested).
 * Use when a season_script rewrite has scene-graph data available.
 */
export function nestedEpisodeSceneModel(): NarrativeUnitModel {
  return { outerUnit: 'episode', innerUnit: 'scene', nested: true };
}

/**
 * Returns the human-readable unit label for progress display.
 * Never returns "chunk" — always a narrative term.
 */
export function unitLabel(unit: NarrativeUnitType, plural = false): string {
  const labels: Record<NarrativeUnitType, [string, string]> = {
    episode: ['Episode', 'Episodes'],
    scene: ['Scene', 'Scenes'],
    section: ['Section', 'Sections'],
  };
  return labels[unit]?.[plural ? 1 : 0] ?? (plural ? 'Units' : 'Unit');
}

/**
 * Build a progress string that reflects true narrative units.
 */
export function narrativeProgressLabel(
  docType: string,
  current: number,
  total: number,
  affected: number,
  mode: 'generating' | 'rewriting' = 'generating',
): string {
  const model = unitModelFor(docType);
  const uLabel = unitLabel(model.outerUnit);
  const verb = mode === 'rewriting' ? 'Rewriting' : 'Generating';

  if (mode === 'rewriting') {
    return `${verb} ${uLabel} ${current} — ${uLabel} ${current} of ${affected} affected`;
  }
  return `${verb} ${uLabel} ${current} of ${total}`;
}

/**
 * Returns true if the doc type must enforce per-unit preservation
 * (unaffected units unchanged) during selective rewrites.
 */
export function requiresUnitPreservation(docType: string): boolean {
  return EPISODE_UNIT_DOC_TYPES.has(docType) || SCENE_UNIT_DOC_TYPES.has(docType);
}

/**
 * Returns true if this doc type should NEVER use generic "chunk" terminology
 * in operator-facing UI or logs.
 */
export function hasKnownNarrativeUnit(docType: string): boolean {
  return EPISODE_UNIT_DOC_TYPES.has(docType) || SCENE_UNIT_DOC_TYPES.has(docType);
}
