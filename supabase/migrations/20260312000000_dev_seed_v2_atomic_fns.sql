-- ============================================================
-- Dev Seed v2 — Transactional Write Functions (DS2E)
--
-- Provides true DB-level atomicity for:
--   ds2_update_seed        → replaces specified seed layers in one transaction
--   ds2_sync_seed_to_canon → promotes promotable layers to canonical tables
--
-- Architecture:
--   All validation is done in the TypeScript application layer (edge function).
--   These functions perform ONLY the write sequence.
--   Any raised exception causes PostgreSQL to auto-rollback the entire function.
--   Called via supabase.rpc() from the dev-engine-v2 edge function.
--
-- SECURITY DEFINER: runs as owner (bypasses RLS for service-role callers).
-- SET search_path = public: prevents search_path injection attacks.
-- ============================================================

-- ── Function 1: ds2_update_seed ──────────────────────────────────────────────
--
-- Atomically replaces Dev Seed v2 layers specified in p_patch.
-- Unspecified layers are left untouched.
-- Presence of a key in p_patch (even with empty array/null) triggers replacement.
--
-- Layer replacement semantics:
--   Layer 1 (root fields): UPDATE in-place (never deleted)
--   Layers 2–8 (child rows): DELETE all seed rows → INSERT new rows
--   If entities replaced, relations also cleared and reinserted if provided.
--
-- Always: sets updated_at = now(), promoted_at = NULL (seed marked dirty).
-- Returns JSONB with {ok, seed_id, updated_at, updated_layers}
-- Raises on any DB error (auto-rollback).
--
CREATE OR REPLACE FUNCTION public.ds2_update_seed(
  p_seed_id    uuid,
  p_project_id uuid,
  p_patch      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_layers  text[]      := '{}';
  v_now             timestamptz := now();
  v_entities_replaced boolean   := false;
BEGIN

  -- ── Layer 1: Root fields (UPDATE in-place) ─────────────────────────────
  -- Always set updated_at + promoted_at=NULL.
  -- Conditionally update each L1 field only if present in patch.
  UPDATE dev_seed_v2_projects SET
    title             = CASE WHEN p_patch ? 'title'             THEN p_patch->>'title'             ELSE title             END,
    lane              = CASE WHEN p_patch ? 'lane'              THEN p_patch->>'lane'              ELSE lane              END,
    format            = CASE WHEN p_patch ? 'format'            THEN p_patch->>'format'            ELSE format            END,
    target_audience   = CASE WHEN p_patch ? 'target_audience'   THEN p_patch->>'target_audience'   ELSE target_audience   END,
    genre_stack       = CASE WHEN p_patch ? 'genre_stack'
                              THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(p_patch->'genre_stack')))
                              ELSE genre_stack END,
    tone_contract     = CASE WHEN p_patch ? 'tone_contract'     THEN p_patch->>'tone_contract'     ELSE tone_contract     END,
    market_hook       = CASE WHEN p_patch ? 'market_hook'       THEN p_patch->>'market_hook'       ELSE market_hook       END,
    runtime_pattern   = CASE WHEN p_patch ? 'runtime_pattern'   THEN p_patch->>'runtime_pattern'   ELSE runtime_pattern   END,
    episode_pattern   = CASE WHEN p_patch ? 'episode_pattern'   THEN p_patch->>'episode_pattern'   ELSE episode_pattern   END,
    comparable_mode   = CASE WHEN p_patch ? 'comparable_mode'   THEN p_patch->>'comparable_mode'   ELSE comparable_mode   END,
    updated_at        = v_now,
    promoted_at       = NULL
  WHERE id = p_seed_id AND project_id = p_project_id;

  -- Surface any L1 field patches in updated_layers
  IF p_patch ?| ARRAY['title','lane','format','target_audience','genre_stack',
                       'tone_contract','market_hook','runtime_pattern',
                       'episode_pattern','comparable_mode'] THEN
    v_updated_layers := array_append(v_updated_layers, 'layer_1_project_identity');
  END IF;

  -- ── Layer 2: Premise Kernel ────────────────────────────────────────────
  IF p_patch ? 'premise' THEN
    DELETE FROM dev_seed_v2_premise WHERE seed_id = p_seed_id;
    IF (p_patch->'premise') IS NOT NULL THEN
      INSERT INTO dev_seed_v2_premise (
        seed_id, project_id, premise, dramatic_question, central_irony,
        emotional_promise, audience_fantasy, audience_fear, theme_vector
      ) VALUES (
        p_seed_id, p_project_id,
        p_patch->'premise'->>'premise',
        p_patch->'premise'->>'dramatic_question',
        p_patch->'premise'->>'central_irony',
        p_patch->'premise'->>'emotional_promise',
        p_patch->'premise'->>'audience_fantasy',
        p_patch->'premise'->>'audience_fear',
        p_patch->'premise'->>'theme_vector'
      );
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_2_premise');
  END IF;

  -- ── Layer 3: Narrative Axes ────────────────────────────────────────────
  IF p_patch ? 'axes' THEN
    DELETE FROM dev_seed_v2_axes WHERE seed_id = p_seed_id;
    IF jsonb_array_length(p_patch->'axes') > 0 THEN
      INSERT INTO dev_seed_v2_axes (
        seed_id, project_id, axis_key, axis_statement, axis_role, axis_priority, axis_confidence
      )
      SELECT
        p_seed_id, p_project_id,
        ax->>'axis_key',
        ax->>'axis_statement',
        ax->>'axis_role',
        COALESCE((ax->>'axis_priority')::int, 0),
        COALESCE((ax->>'axis_confidence')::numeric, 1.0)
      FROM jsonb_array_elements(p_patch->'axes') ax;
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_3_axes');
  END IF;

  -- ── Layer 4: Narrative Units ───────────────────────────────────────────
  IF p_patch ? 'units' THEN
    DELETE FROM dev_seed_v2_units WHERE seed_id = p_seed_id;
    IF jsonb_array_length(p_patch->'units') > 0 THEN
      INSERT INTO dev_seed_v2_units (
        seed_id, project_id, unit_key, unit_type, axis_source,
        unit_statement, success_state, failure_mode, dependency_position, initial_alignment_status
      )
      SELECT
        p_seed_id, p_project_id,
        u->>'unit_key',
        u->>'unit_type',
        u->>'axis_source',
        u->>'unit_statement',
        u->>'success_state',
        u->>'failure_mode',
        CASE WHEN (u->>'dependency_position') IS NOT NULL THEN (u->>'dependency_position')::int ELSE NULL END,
        COALESCE(u->>'initial_alignment_status', 'aligned')
      FROM jsonb_array_elements(p_patch->'units') u;
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_4_units');
  END IF;

  -- ── Layer 5: Entities (cascades to relations) ──────────────────────────
  -- When entities are replaced, existing relations are also cleared (FK + explicit DELETE).
  -- Relations from the patch (if also provided) are re-inserted after entities.
  IF p_patch ? 'entities' THEN
    v_entities_replaced := true;
    DELETE FROM dev_seed_v2_entity_relations WHERE seed_id = p_seed_id;
    DELETE FROM dev_seed_v2_entities WHERE seed_id = p_seed_id;

    IF jsonb_array_length(p_patch->'entities') > 0 THEN
      INSERT INTO dev_seed_v2_entities (
        seed_id, project_id, entity_key, entity_name, entity_type,
        narrative_role, description, aliases, story_critical_flag
      )
      SELECT
        p_seed_id, p_project_id,
        e->>'entity_key',
        COALESCE(e->>'entity_name', e->>'entity_key'),
        e->>'entity_type',
        e->>'narrative_role',
        e->>'description',
        CASE WHEN (e->'aliases') IS NOT NULL
             THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(e->'aliases')))
             ELSE '{}'::text[] END,
        COALESCE((e->>'story_critical_flag')::boolean, false)
      FROM jsonb_array_elements(p_patch->'entities') e;
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_5_entities');
  END IF;

  -- ── Layer 5b: Entity Relations ─────────────────────────────────────────
  -- Insert if entity_relations key is present.
  -- If entities were also replaced above, the relations DELETE already happened.
  -- If entities were NOT replaced, we DELETE relations here first.
  IF p_patch ? 'entity_relations' THEN
    IF NOT v_entities_replaced THEN
      DELETE FROM dev_seed_v2_entity_relations WHERE seed_id = p_seed_id;
    END IF;
    IF jsonb_array_length(p_patch->'entity_relations') > 0 THEN
      INSERT INTO dev_seed_v2_entity_relations (
        seed_id, project_id, source_entity_key, relation_type, target_entity_key
      )
      SELECT
        p_seed_id, p_project_id,
        COALESCE(r->>'source_entity_key', r->>'source_entity'),
        r->>'relation_type',
        COALESCE(r->>'target_entity_key', r->>'target_entity')
      FROM jsonb_array_elements(p_patch->'entity_relations') r;
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_5_entity_relations');
  END IF;

  -- ── Layer 6: Canon Rules ───────────────────────────────────────────────
  IF p_patch ? 'canon_rules' THEN
    DELETE FROM dev_seed_v2_canon_rules WHERE seed_id = p_seed_id;
    IF jsonb_array_length(p_patch->'canon_rules') > 0 THEN
      INSERT INTO dev_seed_v2_canon_rules (
        seed_id, project_id, rule_key, rule_description, rule_scope, severity
      )
      SELECT
        p_seed_id, p_project_id,
        r->>'rule_key',
        r->>'rule_description',
        r->>'rule_scope',
        COALESCE(r->>'severity', 'moderate')
      FROM jsonb_array_elements(p_patch->'canon_rules') r;
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_6_canon_rules');
  END IF;

  -- ── Layer 7: Beat Seeds ────────────────────────────────────────────────
  IF p_patch ? 'beats' THEN
    DELETE FROM dev_seed_v2_beats WHERE seed_id = p_seed_id;
    IF jsonb_array_length(p_patch->'beats') > 0 THEN
      INSERT INTO dev_seed_v2_beats (
        seed_id, project_id, beat_key, beat_description, narrative_axis_reference, expected_turn
      )
      SELECT
        p_seed_id, p_project_id,
        b->>'beat_key',
        b->>'beat_description',
        b->>'narrative_axis_reference',
        b->>'expected_turn'
      FROM jsonb_array_elements(p_patch->'beats') b;
    END IF;
    v_updated_layers := array_append(v_updated_layers, 'layer_7_beats');
  END IF;

  -- ── Layer 8: Generation Intent ─────────────────────────────────────────
  IF p_patch ? 'generation_intent' AND (p_patch->'generation_intent') IS NOT NULL THEN
    DELETE FROM dev_seed_v2_generation_intent WHERE seed_id = p_seed_id;
    INSERT INTO dev_seed_v2_generation_intent (
      seed_id, project_id, projection_targets, pacing_bias, dialogue_density,
      mystery_opacity, commercial_vs_auteur_scale, tone_intensity
    ) VALUES (
      p_seed_id, p_project_id,
      CASE WHEN (p_patch->'generation_intent'->'projection_targets') IS NOT NULL
           THEN (SELECT ARRAY(SELECT jsonb_array_elements_text(p_patch->'generation_intent'->'projection_targets')))
           ELSE '{}'::text[] END,
      p_patch->'generation_intent'->>'pacing_bias',
      p_patch->'generation_intent'->>'dialogue_density',
      p_patch->'generation_intent'->>'mystery_opacity',
      CASE WHEN (p_patch->'generation_intent'->>'commercial_vs_auteur_scale') IS NOT NULL
           THEN (p_patch->'generation_intent'->>'commercial_vs_auteur_scale')::numeric
           ELSE NULL END,
      p_patch->'generation_intent'->>'tone_intensity'
    );
    v_updated_layers := array_append(v_updated_layers, 'layer_8_generation_intent');
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'seed_id',        p_seed_id,
    'updated_at',     v_now,
    'updated_layers', to_jsonb(v_updated_layers)
  );

  -- Any RAISE from any INSERT/DELETE/UPDATE above auto-rolls back the function.
END;
$$;


-- ── Function 2: ds2_sync_seed_to_canon ───────────────────────────────────────
--
-- Atomically promotes Dev Seed v2 promotable layers into canonical runtime tables.
-- All writes succeed or none persist.
--
-- Promotable layers:
--   Layer 3 → projects.narrative_spine_json (write-once guard — only if NULL)
--   Layer 4 → narrative_units (UPSERT on project_id, unit_type, unit_key)
--   Layer 5a → narrative_entities (UPSERT on project_id, entity_key)
--   Layer 5b → narrative_entity_relations (INSERT ON CONFLICT DO NOTHING)
--
-- Seed-only layers (not promoted): 1, 2, 6, 7, 8
--
-- On success: updates dev_seed_v2_projects.promoted_at + promotion_summary.
-- Returns JSONB with {ok, seed_id, promoted_at, promotions{...}}
-- Raises on any DB error (auto-rollback).
--
CREATE OR REPLACE FUNCTION public.ds2_sync_seed_to_canon(
  p_seed_id    uuid,
  p_project_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now               timestamptz  := now();
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

  -- ── Step 1: Layer 3 → narrative_spine_json (write-once) ───────────────
  -- Build spine JSON from valid seed axes, then UPDATE only if currently NULL.
  SELECT jsonb_object_agg(axis_key, axis_statement) INTO v_spine_json
  FROM dev_seed_v2_axes
  WHERE seed_id = p_seed_id AND axis_key = ANY(v_valid_axes);

  IF v_spine_json IS NOT NULL THEN
    UPDATE projects
    SET narrative_spine_json = v_spine_json
    WHERE id = p_project_id AND narrative_spine_json IS NULL;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      -- Count how many axes were actually written
      SELECT COUNT(*) INTO v_spine_promoted
      FROM dev_seed_v2_axes
      WHERE seed_id = p_seed_id AND axis_key = ANY(v_valid_axes);
    ELSE
      v_spine_skip_reason := 'spine_already_set — use spine-amendment to amend individual axes';
    END IF;
  END IF;

  -- ── Step 2: Layer 4 → narrative_units (UPSERT) ────────────────────────
  -- unit_key = {seed_id}::{unit_type} matches canonical {version_uuid}::axis format.
  -- UPSERT: update payload_json + updated_at on repeat sync (idempotent).
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
    NULL,          -- source_doc_version_id: FK to project_document_versions — null for seed
    1.0,
    'dev_seed_v2_promotion',
    COALESCE(u.initial_alignment_status, 'aligned'),
    v_now
  FROM dev_seed_v2_units u
  WHERE u.seed_id = p_seed_id
  ON CONFLICT (project_id, unit_type, unit_key)
  DO UPDATE SET
    payload_json       = EXCLUDED.payload_json,
    source_doc_type    = EXCLUDED.source_doc_type,
    updated_at         = EXCLUDED.updated_at;

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
  -- Entity UUIDs resolved via JOIN — entities were just upserted above in this
  -- same transaction, so they are visible to this SELECT.
  -- ON CONFLICT DO NOTHING: safe repeat sync.
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
    'promotions', jsonb_build_object(
      'layer_3_axes_to_spine',  v_spine_promoted,
      'spine_skip_reason',      v_spine_skip_reason,
      'layer_4_units',          v_units_promoted,
      'layer_5_entities',       v_entities_promoted,
      'layer_5_relations',      v_relations_promoted
    )
  );

  -- Any RAISE from any step above auto-rolls back the function.
END;
$$;

-- ── Permissions ───────────────────────────────────────────────────────────────
-- Functions are SECURITY DEFINER so they run as postgres (owner).
-- Grant execute to service_role (edge functions) and authenticated (future direct calls).
GRANT EXECUTE ON FUNCTION public.ds2_update_seed(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.ds2_update_seed(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ds2_sync_seed_to_canon(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.ds2_sync_seed_to_canon(uuid, uuid) TO authenticated;
