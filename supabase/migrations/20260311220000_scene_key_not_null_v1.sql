-- ============================================================
-- scene_key NOT NULL — final scene identity hardening
-- ============================================================
--
-- Pre-condition verified against production before applying:
--   SELECT COUNT(*) FROM public.scene_graph_scenes WHERE scene_key IS NULL
--   → 0 rows (confirmed via audit_null_scene_keys op, 2026-03-11)
--
-- All known write paths always provide scene_key:
--   scene_graph_atomic_write RPC  → scene_key in INSERT column list
--   scene_graph_insert (inline)   → sgNextSceneKeys(…) always returns a key
--   scene_graph_split             → sgNextSceneKeys(…, 2)
--   scene_graph_merge             → sgNextSceneKeys(…, 1)
--   changeset scene insert        → sgNextSceneKeys(…, 1)
--   test_partial_graph_then_restore → hardcoded "SCENE_TEST_ORPHAN"
--
-- This migration closes the residual nullable risk on the identity column.
-- Combined with the existing partial unique index
--   (project_id, scene_key) WHERE (scene_key IS NOT NULL)
-- scene_key is now both guaranteed non-null and unique per project.
--
-- Blast radius: none. The column already has zero NULLs in production.
-- The constraint addition is instant (no table rewrite required for NOT NULL
-- when no NULLs exist + a CHECK constraint can be validated without scan).
-- PostgreSQL will validate NOT NULL against existing rows; since count=0,
-- this completes immediately.
--
-- Downstream effects: none. All consumers either filter on deprecated_at IS NULL
-- or scene_key IS NOT NULL — both remain valid and equivalent for real rows.

ALTER TABLE public.scene_graph_scenes
  ALTER COLUMN scene_key SET NOT NULL;

COMMENT ON COLUMN public.scene_graph_scenes.scene_key IS
  'Canonical scene identity key (SCENE_NNN format). '
  'Assigned at creation by sgNextSceneKeys; never recomputed or reused. '
  'Unique per project via partial unique index. Not null enforced at DB layer. '
  'Deprecated scenes retain their key permanently.';
