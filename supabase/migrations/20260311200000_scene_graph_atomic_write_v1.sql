-- ============================================================
-- scene_graph_atomic_write — transactional scene graph extraction
-- ============================================================
--
-- Replaces the per-scene triple-INSERT loop in dev-engine-v2 with a single
-- PL/pgSQL function that wraps all scene/version/order inserts inside one
-- implicit transaction. Any failure inside the function rolls back every
-- write, leaving no partial scene graph state.
--
-- Called by: dev-engine-v2 → scene_graph_extract (force:false and force:true)
--
-- Atomic boundary:
--   force:false → INSERT all scenes, versions, order rows OR nothing
--   force:true  → DELETE old graph + INSERT new graph OR old graph is fully
--                 preserved (the old graph is only removed if the full new
--                 graph commits successfully)
--
-- Tables written inside the transaction:
--   scene_graph_scenes   (N inserts)
--   scene_graph_versions (N inserts)
--   scene_graph_order    (N inserts)
--   scene_graph_snapshots (DELETE only, when force:true)
--   scene_graph_scenes    (DELETE only, when force:true → cascades to versions+order)
--
-- Tables NOT written inside this function:
--   scene_graph_snapshots INSERT — remains in calling TypeScript (post-commit)
--   narrative_scene_entity_links  — remains post-commit fail-safe sync
--
-- Input: p_scenes JSONB array, each element:
--   {
--     "scene_key":   "SCENE_001",
--     "scene_kind":  "narrative",
--     "order_key":   "0lispp",
--     "slugline":    "INT. HALLWAY - DAY",
--     "location":    "HALLWAY",
--     "time_of_day": "DAY",
--     "content":     "Full scene text...",
--     "summary":     "First 200 chars..."
--   }
--
-- Returns: JSONB array of inserted results:
--   [{ "scene_id": uuid, "scene_key": text, "version_id": uuid, "order_key": text }, ...]

CREATE OR REPLACE FUNCTION public.scene_graph_atomic_write(
  p_project_id  uuid,
  p_created_by  uuid,
  p_force       boolean DEFAULT false,
  p_scenes      jsonb   DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_entry    jsonb;
  v_scene    record;
  v_version  record;
  v_results  jsonb := '[]'::jsonb;
BEGIN
  -- ── Force mode: atomically remove existing graph ─────────────────────────
  -- Snapshots must be deleted explicitly (no FK cascade from scenes → snapshots).
  -- Deleting from scene_graph_scenes cascades to scene_graph_versions and
  -- scene_graph_order via their scene_id FK (ON DELETE CASCADE).
  IF p_force THEN
    DELETE FROM public.scene_graph_snapshots WHERE project_id = p_project_id;
    DELETE FROM public.scene_graph_scenes    WHERE project_id = p_project_id;
    -- scene_graph_versions and scene_graph_order are cascade-deleted above.
  END IF;

  -- ── Insert all scenes atomically ─────────────────────────────────────────
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scenes) LOOP

    -- 1. Scene identity row
    INSERT INTO public.scene_graph_scenes (
      project_id, scene_kind, scene_key, created_by
    ) VALUES (
      p_project_id,
      COALESCE(v_entry->>'scene_kind', 'narrative'),
      v_entry->>'scene_key',
      p_created_by
    )
    RETURNING * INTO v_scene;

    -- 2. Initial version (version_number=1, status=draft)
    INSERT INTO public.scene_graph_versions (
      scene_id, project_id, version_number, status, created_by,
      slugline, location, time_of_day, content, summary
    ) VALUES (
      v_scene.id,
      p_project_id,
      1,
      'draft',
      p_created_by,
      COALESCE(v_entry->>'slugline', ''),
      COALESCE(v_entry->>'location', ''),
      COALESCE(v_entry->>'time_of_day', ''),
      COALESCE(v_entry->>'content', ''),
      COALESCE(v_entry->>'summary', '')
    )
    RETURNING * INTO v_version;

    -- 3. Active order entry
    INSERT INTO public.scene_graph_order (
      project_id, scene_id, order_key, is_active, act
    ) VALUES (
      p_project_id,
      v_scene.id,
      v_entry->>'order_key',
      true,
      NULL
    );

    -- Accumulate result for caller
    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'scene_id',   v_scene.id,
        'scene_key',  v_scene.scene_key,
        'version_id', v_version.id,
        'order_key',  v_entry->>'order_key'
      )
    );

  END LOOP;

  RETURN v_results;
END;
$$;

-- Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.scene_graph_atomic_write(uuid, uuid, boolean, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.scene_graph_atomic_write IS
  'Atomically inserts a full batch of scene/version/order rows for a project. '
  'All writes commit together or none persist. '
  'When p_force=true, existing graph (snapshots + scenes → cascade) is deleted inside '
  'the same transaction, so old graph is fully preserved if new write fails.';
