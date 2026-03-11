/**
 * sceneGraphClassifier.ts — Deterministic Scene Graph State Classification
 *
 * Classifies the structural integrity of a project's scene graph as one of:
 *
 *   EMPTY_GRAPH     — no active scene_graph_scenes rows for this project
 *   PARTIAL_GRAPH   — scenes exist but structural inconsistency detected
 *   POPULATED_GRAPH — scenes exist and structure is internally consistent
 *
 * This classification is ADVISORY ONLY.
 * It does not change retry policy, rebuild behaviour, or any downstream state.
 * Retry guard remains: scene_count > 0 → retry blocked (regardless of classification).
 *
 * ── Evidence basis ────────────────────────────────────────────────────────────
 *
 * scene_graph_extract runs scene-by-scene with no wrapping transaction.
 * Each scene requires 3 sequential PostgREST inserts:
 *   1. scene_graph_scenes   (scene row)
 *   2. scene_graph_versions (content + metadata; FK on scene.id)
 *   3. scene_graph_order    (position in ordered list; FK on scene.id)
 *
 * If extraction fails mid-loop, depending on which insert failed:
 *
 *   Failure A (scene INSERT fails):
 *     - Loop throws; remaining scenes not extracted
 *     - Produces a key gap: max(SCENE_NNN) > count (if scene inserted then failed)
 *       Actually: if this scene's INSERT failed, it wasn't added — previous scenes are intact
 *       Signal: count < expected (but expected is unknown at classify time)
 *
 *   Failure B (version INSERT fails):
 *     - scene row exists, no version row → ORPHAN SCENE
 *     - Loop throws; remaining scenes not extracted
 *     - Signal: scene with no matching scene_graph_versions row
 *
 *   Failure C (order INSERT fails):
 *     - scene row + version exist, no active order entry → ORDERLESS SCENE
 *     - Loop throws; remaining scenes not extracted
 *     - Signal: scene with no is_active=true scene_graph_order row
 *
 *   Failure D (snapshot INSERT fails after loop):
 *     - All scenes intact; no snapshot
 *     - Classification treats as POPULATED (snapshot is metadata, not structural)
 *
 * ── Signals used ──────────────────────────────────────────────────────────────
 *
 *   scene_count           Total active (deprecated_at IS NULL) scenes
 *   orphan_count          Scenes with no scene_graph_versions row
 *   missing_order_count   Scenes with no is_active=true scene_graph_order row
 *   key_gap_count         Gaps in the SCENE_NNN numeric sequence
 *
 * scene_count alone is insufficient — a count of 12 could be a 12-scene script
 * (healthy) or a partially extracted 25-scene script (partial).
 * Structural signals (orphans, missing order, key gaps) are required.
 *
 * ── Classification rules ──────────────────────────────────────────────────────
 *
 *   scene_count = 0                          → EMPTY_GRAPH
 *   scene_count > 0 AND any of:
 *     orphan_count > 0                       → PARTIAL_GRAPH
 *     missing_order_count > 0                → PARTIAL_GRAPH
 *     key_gap_count > 0                      → PARTIAL_GRAPH
 *   scene_count > 0 AND all signals = 0     → POPULATED_GRAPH
 *
 * Note: POPULATED_GRAPH does not assert completeness (we don't know how many
 * scenes the script has). It asserts internal structural consistency only.
 */

export type SceneGraphState =
  | 'EMPTY_GRAPH'
  | 'PARTIAL_GRAPH'
  | 'POPULATED_GRAPH';

export interface SceneGraphClassification {
  state:               SceneGraphState;
  scene_count:         number;
  orphan_count:        number;   // scenes with no version row
  missing_order_count: number;   // scenes with no active order row
  key_gap_count:       number;   // gaps in SCENE_NNN sequence
  first_key:           string | null;
  last_key:            string | null;
  signals:             string[];  // human-readable list of detected signals
}

const SCENE_KEY_RE = /^SCENE_(\d+)$/;

/**
 * Classifies the scene graph state for a given project.
 * Read-only: makes no writes, no mutations.
 *
 * @param supabase  Supabase client with project access (service role or authenticated)
 * @param projectId UUID of the project to classify
 */
export async function classifySceneGraphState(
  supabase: any,
  projectId: string,
): Promise<SceneGraphClassification> {

  // ── Query 1: all active scenes (id + scene_key) ───────────────────────────
  const { data: scenes, error: sceneErr } = await supabase
    .from('scene_graph_scenes')
    .select('id, scene_key')
    .eq('project_id', projectId)
    .is('deprecated_at', null);

  if (sceneErr) throw new Error(`[sceneGraphClassifier] scenes query failed: ${sceneErr.message}`);

  const sceneCount = (scenes ?? []).length;

  if (sceneCount === 0) {
    return {
      state:               'EMPTY_GRAPH',
      scene_count:         0,
      orphan_count:        0,
      missing_order_count: 0,
      key_gap_count:       0,
      first_key:           null,
      last_key:            null,
      signals:             ['scene_count=0'],
    };
  }

  // Build sets for cross-checks
  const allSceneIds = new Set<string>((scenes as any[]).map(s => s.id));

  // ── Query 2: scene IDs that have at least one version ────────────────────
  const { data: versionedRows, error: verErr } = await supabase
    .from('scene_graph_versions')
    .select('scene_id')
    .eq('project_id', projectId)
    .in('scene_id', [...allSceneIds]);
  if (verErr) throw new Error(`[sceneGraphClassifier] versions query failed: ${verErr.message}`);

  const versionedSceneIds = new Set<string>(
    (versionedRows ?? []).map((r: any) => r.scene_id)
  );

  // ── Query 3: scene IDs that have an active order entry ───────────────────
  const { data: orderedRows, error: ordErr } = await supabase
    .from('scene_graph_order')
    .select('scene_id')
    .eq('project_id', projectId)
    .eq('is_active', true)
    .in('scene_id', [...allSceneIds]);
  if (ordErr) throw new Error(`[sceneGraphClassifier] order query failed: ${ordErr.message}`);

  const orderedSceneIds = new Set<string>(
    (orderedRows ?? []).map((r: any) => r.scene_id)
  );

  // ── Compute signals ───────────────────────────────────────────────────────

  // Orphan count: scenes with no version
  let orphanCount = 0;
  for (const id of allSceneIds) {
    if (!versionedSceneIds.has(id)) orphanCount++;
  }

  // Missing order count: scenes with no active order entry
  let missingOrderCount = 0;
  for (const id of allSceneIds) {
    if (!orderedSceneIds.has(id)) missingOrderCount++;
  }

  // Key gap count: gaps in SCENE_NNN numeric sequence
  const nums: number[] = [];
  for (const row of (scenes as any[])) {
    const m = SCENE_KEY_RE.exec(row.scene_key ?? '');
    if (m) nums.push(parseInt(m[1], 10));
  }
  nums.sort((a, b) => a - b);

  let keyGapCount = 0;
  const sortedKeys = (scenes as any[])
    .map((s: any) => s.scene_key)
    .filter(Boolean)
    .sort();

  if (nums.length > 1) {
    const minKey = nums[0];
    const maxKey = nums[nums.length - 1];
    const numSet = new Set(nums);
    for (let n = minKey; n <= maxKey; n++) {
      if (!numSet.has(n)) keyGapCount++;
    }
  }

  // First/last key (by scene_key sort)
  const firstKey = sortedKeys[0] ?? null;
  const lastKey  = sortedKeys[sortedKeys.length - 1] ?? null;

  // ── Determine state ───────────────────────────────────────────────────────
  const signals: string[] = [];
  if (orphanCount > 0)       signals.push(`orphan_scenes=${orphanCount}`);
  if (missingOrderCount > 0) signals.push(`missing_order=${missingOrderCount}`);
  if (keyGapCount > 0)       signals.push(`key_gaps=${keyGapCount}`);

  const state: SceneGraphState =
    signals.length > 0 ? 'PARTIAL_GRAPH' : 'POPULATED_GRAPH';

  return {
    state,
    scene_count:         sceneCount,
    orphan_count:        orphanCount,
    missing_order_count: missingOrderCount,
    key_gap_count:       keyGapCount,
    first_key:           firstKey,
    last_key:            lastKey,
    signals:             signals.length > 0 ? signals : ['all_signals_clean'],
  };
}
