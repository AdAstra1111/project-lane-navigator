-- ============================================================
-- scene_key unique index — codifying existing production constraint
-- ============================================================
--
-- This migration records the partial unique index that was already deployed
-- to production outside the migrations folder.
--
-- Index already present in production:
--   CREATE UNIQUE INDEX idx_scene_graph_scenes_project_scene_key
--   ON public.scene_graph_scenes USING btree (project_id, scene_key)
--   WHERE (scene_key IS NOT NULL)
--
-- Design rationale:
--
-- 1. PARTIAL ON scene_key IS NOT NULL, not on deprecated_at IS NULL
--    scene_key is nullable in the schema (added after table creation).
--    Any pre-key-era rows have NULL scene_key and are excluded.
--    The index does NOT filter on deprecated_at — deprecated scenes retain
--    their scene_key permanently. This is correct for IFFY's immutable
--    scene identity model: a deprecated SCENE_007 must prevent any future
--    scene from being assigned SCENE_007.
--
-- 2. Compatibility with sgNextSceneKeys
--    sgNextSceneKeys queries scene_graph_scenes WITHOUT a deprecated_at filter
--    (only filters scene_key IS NOT NULL), so it correctly reads deprecated
--    rows when computing the MAX key, preventing key reuse.
--
-- 3. Compatibility with scene_graph_atomic_write (force:true)
--    force:true deletes ALL scenes for the project (DELETE WHERE project_id=X),
--    which includes deprecated rows. The cascade removes versions + order.
--    After deletion, scene_keys start from SCENE_001 with no conflicts.
--
-- 4. No duplicate risk from extraction
--    Pre-flight guard (scene_count > 0 → throw) prevents concurrent extraction.
--    force:true clears the table before inserting, so no stale keys remain.
--
-- Pre-application check:
--   SELECT COUNT(*) FROM public.scene_graph_scenes
--   WHERE deprecated_at IS NULL AND scene_key IS NOT NULL
--   GROUP BY project_id, scene_key HAVING COUNT(*) > 1
--   → 0 rows (verified against production before applying)
--
-- Idempotent: IF NOT EXISTS ensures safe re-application.

CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_graph_scenes_project_scene_key
  ON public.scene_graph_scenes (project_id, scene_key)
  WHERE (scene_key IS NOT NULL);

COMMENT ON INDEX public.idx_scene_graph_scenes_project_scene_key IS
  'Partial unique index enforcing scene_key uniqueness per project. '
  'Covers all rows (active + deprecated) where scene_key IS NOT NULL. '
  'Deprecated scenes retain their key permanently — keys are never reused. '
  'sgNextSceneKeys reads all rows to correctly compute the next key offset.';
