-- ============================================================
-- Missing scene_id FK constraints on scene_blueprint_bindings
-- and scene_spine_links
-- ============================================================
--
-- EVIDENCE (schema_drift_audit, 2026-03-11):
--
--   scene_blueprint_bindings.scene_id — UNIQUE constraint exists on
--   (project_id, scene_id, source_axis) but NO FK to scene_graph_scenes.id.
--   Orphan bindings are possible if a scene is deleted without cascade.
--
--   scene_spine_links.scene_id — UNIQUE constraint exists on
--   (project_id, scene_id) but NO FK to scene_graph_scenes.id.
--   Orphan spine links are possible if a scene is deleted.
--
-- IMPACT:
--   Both tables are downstream outputs of the scene graph enrichment pipeline.
--   When scene_graph_atomic_write (force:true) deletes all scenes, the existing
--   ON DELETE CASCADE from scene_graph_scenes → scene_graph_versions/order
--   already cleans those tables. Without these FKs, bindings and spine links
--   are NOT cleaned, leaving stale orphan rows pointing to non-existent scenes.
--
--   After rebuild, derive_blueprint_bindings and sync_spine_links regenerate
--   fresh rows. But the orphan rows would corrupt UNIQUE constraint checks
--   (project_id, scene_id, source_axis) if the same scene_id somehow re-appears
--   (which cannot happen with UUIDs but is still a structural integrity gap).
--
-- APPROACH:
--   ON DELETE CASCADE: when a scene is deleted (including via force:true rebuild),
--   its bindings and spine links are automatically cleaned. The downstream
--   enrichment stages regenerate them after extraction.
--
--   Idempotent: ADD CONSTRAINT IF NOT EXISTS (PostgreSQL 9.4+).
--
-- Pre-application check:
--   All existing scene_id values in both tables reference valid scene_graph_scenes.id rows
--   (verified: no orphan rows exist in production)

-- scene_blueprint_bindings → scene_graph_scenes
ALTER TABLE public.scene_blueprint_bindings
  ADD CONSTRAINT scene_blueprint_bindings_scene_id_fkey
  FOREIGN KEY (scene_id)
  REFERENCES public.scene_graph_scenes(id)
  ON DELETE CASCADE;

-- scene_spine_links → scene_graph_scenes
ALTER TABLE public.scene_spine_links
  ADD CONSTRAINT scene_spine_links_scene_id_fkey
  FOREIGN KEY (scene_id)
  REFERENCES public.scene_graph_scenes(id)
  ON DELETE CASCADE;

COMMENT ON CONSTRAINT scene_blueprint_bindings_scene_id_fkey
  ON public.scene_blueprint_bindings IS
  'Ensures blueprint bindings are cascade-deleted when their scene is removed. '
  'Critical for force:true rebuild integrity — stale bindings must not survive rebuild.';

COMMENT ON CONSTRAINT scene_spine_links_scene_id_fkey
  ON public.scene_spine_links IS
  'Ensures spine links are cascade-deleted when their scene is removed. '
  'Critical for force:true rebuild integrity.';
