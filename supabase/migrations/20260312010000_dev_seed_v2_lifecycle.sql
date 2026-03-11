-- ============================================================
-- Dev Seed v2 — Lifecycle Control Functions (DS2F)
--
-- ds2_delete_seed          → atomic deletion of seed + all layers via CASCADE
-- ds2_sync_seed_to_canon   → replaced with 3-param version adding p_force_resync
--
-- All functions SECURITY DEFINER, SET search_path = public.
-- ============================================================

-- ── Function 1: ds2_delete_seed ──────────────────────────────────────────────
--
-- Atomically deletes a Dev Seed v2 root row and all child layers.
-- Child deletion is handled by ON DELETE CASCADE from dev_seed_v2_projects.
-- Row counts per layer are captured BEFORE deletion within the same transaction.
--
-- Returns JSONB with {ok, seed_id, deleted_layers, layer_counts}
-- Returns {ok:false} if seed not found for this project.
--
CREATE OR REPLACE FUNCTION public.ds2_delete_seed(
  p_seed_id    uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_premise_count  int := 0;
  v_axes_count     int := 0;
  v_units_count    int := 0;
  v_entities_count int := 0;
  v_rel_count      int := 0;
  v_rules_count    int := 0;
  v_beats_count    int := 0;
  v_intent_count   int := 0;
  v_rows           int;
BEGIN
  -- Verify seed exists for this project before any work
  PERFORM 1 FROM dev_seed_v2_projects
  WHERE id = p_seed_id AND project_id = p_project_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Seed not found for this project');
  END IF;

  -- Capture per-layer row counts before deletion
  SELECT COUNT(*) INTO v_premise_count  FROM dev_seed_v2_premise           WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_axes_count     FROM dev_seed_v2_axes               WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_units_count    FROM dev_seed_v2_units              WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_entities_count FROM dev_seed_v2_entities           WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_rel_count      FROM dev_seed_v2_entity_relations   WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_rules_count    FROM dev_seed_v2_canon_rules        WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_beats_count    FROM dev_seed_v2_beats              WHERE seed_id = p_seed_id;
  SELECT COUNT(*) INTO v_intent_count   FROM dev_seed_v2_generation_intent  WHERE seed_id = p_seed_id;

  -- Single DELETE cascades to all child tables
  DELETE FROM dev_seed_v2_projects
  WHERE id = p_seed_id AND project_id = p_project_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Race condition safety — should not happen after the PERFORM check above
    RETURN jsonb_build_object('ok', false, 'error', 'Delete found no rows — concurrent deletion?');
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'seed_id',        p_seed_id,
    'deleted_layers', to_jsonb(ARRAY[
      'layer_1_project_identity',
      'layer_2_premise',
      'layer_3_axes',
      'layer_4_units',
      'layer_5_entities',
      'layer_5_entity_relations',
      'layer_6_canon_rules',
      'layer_7_beats',
      'layer_8_generation_intent'
    ]),
    'layer_counts', jsonb_build_object(
      'layer_1_project',          1,
      'layer_2_premise',          v_premise_count,
      'layer_3_axes',             v_axes_count,
      'layer_4_units',            v_units_count,
      'layer_5_entities',         v_entities_count,
      'layer_5_entity_relations', v_rel_count,
      'layer_6_canon_rules',      v_rules_count,
      'layer_7_beats',            v_beats_count,
      'layer_8_generation_intent', v_intent_count
    )
  );
END;
$$;


-- ── Function 2: ds2_sync_seed_to_canon (updated — adds p_force_resync) ───────
--
-- Drop 2-param version (DS2E), replace with 3-param version adding
-- p_force_resync boolean DEFAULT false.
--
-- Behavior change:
--   Normal mode (p_force_resync = false):
--     If promoted_at IS NOT NULL → RAISE EXCEPTION (already promoted guard)
--   Force mode (p_force_resync = true):
--     Proceeds regardless of promoted_at — allows re-promotion after seed update
--
-- All other behavior identical to DS2E version.
-- Provenance (source_doc_type, source_kind, source_key) unchanged on resync.
--
DROP FUNCTION IF EXISTS public.ds2_sync_seed_to_canon(uuid, uuid);

CREATE OR REPLACE FUNCTION public.ds2_sync_seed_to_canon(
  p_seed_id       uuid,
  p_project_id    uuid,
  p_force_resync  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now               timestamptz  := now();
  v_promoted_at       timestamptz;
  v_spine_json        jsonb        := NULL;
  v_spine_promoted    int          := 0;
  v_spine_skip_reason text         := NULL;
  v_units_promoted    int          := 0;
  v_entities_promoted int          := 0;
  v_relations_promoted int         := 0;
  v_rows              int;
  v_valid_axes        text[]       := ARRAY[
    'story_engine','pressure_system','central_conflict','inciting_incident',
    'resolution_type','stakes_class','protagonist_arc','midpoint_reversal','tonal_gravity'
  ];
BEGIN
  -- ── Guard: already-promoted check ─────────────────────────────────────
  -- If seed was previously promoted and force_resync is false → reject.
  -- This prevents accidental double-syncs overwriting canonical state.
  SELECT promoted_at INTO v_promoted_at
  FROM dev_seed_v2_projects
  WHERE id = p_seed_id AND project_id = p_project_id;

  IF v_promoted_at IS NOT NULL AND NOT p_force_resync THEN
    RAISE EXCEPTION 'already_promoted: seed % was promoted at %. Use force_resync=true to re-promote.', p_seed_id, v_promoted_at;
  END IF;

  -- ── Step 1: Layer 3 → narrative_spine_json (write-once) ───────────────
  SELECT jsonb_object_agg(axis_key, axis_statement) INTO v_spine_json
  FROM dev_seed_v2_axes
  WHERE seed_id = p_seed_id AND axis_key = ANY(v_valid_axes);

  IF v_spine_json IS NOT NULL THEN
    UPDATE projects
    SET narrative_spine_json = v_spine_json
    WHERE id = p_project_id AND narrative_spine_json IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      SELECT COUNT(*) INTO v_spine_promoted
      FROM dev_seed_v2_axes
      WHERE seed_id = p_seed_id AND axis_key = ANY(v_valid_axes);
    ELSE
      v_spine_skip_reason := 'spine_already_set — use spine-amendment to amend individual axes';
    END IF;
  END IF;

  -- ── Step 2: Layer 4 → narrative_units (UPSERT) ────────────────────────
  INSERT INTO narrative_units (
    project_id, unit_type, unit_key, payload_json,
    source_doc_type, source_doc_version_id, confidence, extraction_method,
    status, updated_at
  )
  SELECT
    p_project_id,
    u.unit_type,
    p_seed_id::text || '::' || u.unit_type,
    jsonb_build_object(
      'seed_id',        p_seed_id,
      'unit_statement', u.unit_statement,
      'success_state',  u.success_state,
      'failure_mode',   u.failure_mode,
      'seed_unit_key',  u.unit_key
    ),
    'dev_seed_v2',
    NULL,
    1.0,
    'dev_seed_v2_promotion',
    COALESCE(u.initial_alignment_status, 'aligned'),
    v_now
  FROM dev_seed_v2_units u
  WHERE u.seed_id = p_seed_id
  ON CONFLICT (project_id, unit_type, unit_key)
  DO UPDATE SET
    payload_json    = EXCLUDED.payload_json,
    source_doc_type = EXCLUDED.source_doc_type,
    updated_at      = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_units_promoted = ROW_COUNT;

  -- ── Step 3: Layer 5a → narrative_entities (UPSERT) ────────────────────
  INSERT INTO narrative_entities (
    project_id, entity_key, canonical_name, entity_type,
    source_kind, source_key, status, meta_json, updated_at
  )
  SELECT
    p_project_id,
    e.entity_key,
    e.entity_name,
    e.entity_type,
    'dev_seed_v2',
    p_seed_id::text,
    'active',
    jsonb_build_object(
      'narrative_role',      e.narrative_role,
      'description',         e.description,
      'aliases',             e.aliases,
      'story_critical_flag', e.story_critical_flag
    ),
    v_now
  FROM dev_seed_v2_entities e
  WHERE e.seed_id = p_seed_id
  ON CONFLICT (project_id, entity_key)
  DO UPDATE SET
    canonical_name = EXCLUDED.canonical_name,
    source_kind    = EXCLUDED.source_kind,
    source_key     = EXCLUDED.source_key,
    meta_json      = EXCLUDED.meta_json,
    updated_at     = EXCLUDED.updated_at;

  GET DIAGNOSTICS v_entities_promoted = ROW_COUNT;

  -- ── Step 4: Layer 5b → narrative_entity_relations (INSERT, idempotent) ─
  INSERT INTO narrative_entity_relations (
    project_id, source_entity_id, target_entity_id, relation_type,
    source_kind, confidence, updated_at
  )
  SELECT
    p_project_id,
    src.id,
    tgt.id,
    r.relation_type,
    'dev_seed_v2',
    1.0,
    v_now
  FROM dev_seed_v2_entity_relations r
  JOIN narrative_entities src
    ON src.project_id = p_project_id AND src.entity_key = r.source_entity_key
  JOIN narrative_entities tgt
    ON tgt.project_id = p_project_id AND tgt.entity_key = r.target_entity_key
  WHERE r.seed_id = p_seed_id
  ON CONFLICT (source_entity_id, target_entity_id, relation_type) DO NOTHING;

  GET DIAGNOSTICS v_relations_promoted = ROW_COUNT;

  -- ── Step 5: Record promotion in seed root row ──────────────────────────
  UPDATE dev_seed_v2_projects SET
    promoted_at       = v_now,
    promotion_summary = jsonb_build_object(
      'promoted_at',   v_now,
      'force_resync',  p_force_resync,
      'axes_to_spine', v_spine_promoted,
      'spine_skip',    v_spine_skip_reason,
      'units',         v_units_promoted,
      'entities',      v_entities_promoted,
      'relations',     v_relations_promoted
    )
  WHERE id = p_seed_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'seed_id',     p_seed_id,
    'promoted_at', v_now,
    'force_resync', p_force_resync,
    'promotions', jsonb_build_object(
      'layer_3_axes_to_spine', v_spine_promoted,
      'spine_skip_reason',     v_spine_skip_reason,
      'layer_4_units',         v_units_promoted,
      'layer_5_entities',      v_entities_promoted,
      'layer_5_relations',     v_relations_promoted
    )
  );
END;
$$;


-- ── Permissions ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.ds2_delete_seed(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ds2_delete_seed(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ds2_sync_seed_to_canon(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.ds2_sync_seed_to_canon(uuid, uuid, boolean) TO authenticated;
