
-- Update scene_graph_atomic_write to resolve canon_location_id at write time
CREATE OR REPLACE FUNCTION public.scene_graph_atomic_write(p_project_id uuid, p_created_by uuid, p_force boolean DEFAULT false, p_scenes jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entry    jsonb;
  v_scene    record;
  v_version  record;
  v_results  jsonb := '[]'::jsonb;
  v_location text;
  v_norm     text;
  v_canon_id uuid;
  v_match_count int;
BEGIN
  IF p_force THEN
    DELETE FROM public.scene_graph_snapshots WHERE project_id = p_project_id;
    DELETE FROM public.scene_graph_scenes    WHERE project_id = p_project_id;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scenes) LOOP
    INSERT INTO public.scene_graph_scenes (project_id, scene_kind, scene_key, created_by)
    VALUES (p_project_id, COALESCE(v_entry->>'scene_kind','narrative'), v_entry->>'scene_key', p_created_by)
    RETURNING * INTO v_scene;

    -- Resolve canon_location_id from location text
    v_location := COALESCE(BTRIM(v_entry->>'location'), '');
    v_canon_id := NULL;
    IF v_location != '' THEN
      v_norm := lower(regexp_replace(v_location, '[^a-zA-Z0-9]+', '_', 'g'));
      v_norm := trim(both '_' from v_norm);
      -- Only bind on exact single match (no ambiguous guessing)
      SELECT count(*) INTO v_match_count
      FROM public.canon_locations
      WHERE project_id = p_project_id AND normalized_name = v_norm AND active = true;
      IF v_match_count = 1 THEN
        SELECT id INTO v_canon_id
        FROM public.canon_locations
        WHERE project_id = p_project_id AND normalized_name = v_norm AND active = true;
      END IF;
    END IF;

    INSERT INTO public.scene_graph_versions (scene_id, project_id, version_number, status, created_by, slugline, location, time_of_day, content, summary, canon_location_id)
    VALUES (v_scene.id, p_project_id, 1, 'draft', p_created_by,
      COALESCE(v_entry->>'slugline',''), COALESCE(v_entry->>'location',''),
      COALESCE(v_entry->>'time_of_day',''), COALESCE(v_entry->>'content',''), COALESCE(v_entry->>'summary',''), v_canon_id)
    RETURNING * INTO v_version;

    INSERT INTO public.scene_graph_order (project_id, scene_id, order_key, is_active, act)
    VALUES (p_project_id, v_scene.id, v_entry->>'order_key', true, NULL);

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'scene_id', v_scene.id, 'scene_key', v_scene.scene_key,
      'version_id', v_version.id, 'order_key', v_entry->>'order_key'
    ));
  END LOOP;
  RETURN v_results;
END;
$function$;

-- Update next_scene_version to carry forward canon_location_id
CREATE OR REPLACE FUNCTION public.next_scene_version(p_scene_id uuid, p_project_id uuid, p_patch jsonb DEFAULT '{}'::jsonb, p_propose boolean DEFAULT false, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cur record;
  new_ver record;
  next_num integer;
  new_status text;
BEGIN
  SELECT * INTO cur
  FROM scene_graph_versions
  WHERE scene_id = p_scene_id
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  next_num := COALESCE(cur.version_number, 0) + 1;
  new_status := CASE WHEN p_propose THEN 'proposed' ELSE 'draft' END;

  INSERT INTO scene_graph_versions (
    shot_id, project_id, version_number, status, created_by,
    slugline, location, time_of_day, characters_present, purpose,
    beats, summary, content,
    continuity_facts_emitted, continuity_facts_required,
    setup_payoff_emitted, setup_payoff_required, metadata,
    canon_location_id
  ) VALUES (
    p_scene_id, p_project_id, next_num, new_status, p_created_by,
    COALESCE(p_patch->>'slugline', cur.slugline),
    COALESCE(cur.location, ''),
    COALESCE(cur.time_of_day, ''),
    CASE WHEN p_patch ? 'characters_present' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'characters_present')) ELSE COALESCE(cur.characters_present, '{}') END,
    cur.purpose,
    CASE WHEN p_patch ? 'beats' THEN (p_patch->'beats') ELSE COALESCE(to_jsonb(cur.beats), '[]'::jsonb) END,
    COALESCE(p_patch->>'summary', cur.summary),
    COALESCE(p_patch->>'content', cur.content, ''),
    COALESCE(to_jsonb(cur.continuity_facts_emitted), '[]'::jsonb),
    COALESCE(to_jsonb(cur.continuity_facts_required), '[]'::jsonb),
    COALESCE(to_jsonb(cur.setup_payoff_emitted), '[]'::jsonb),
    COALESCE(to_jsonb(cur.setup_payoff_required), '[]'::jsonb),
    COALESCE(cur.metadata, '{}'::jsonb),
    cur.canon_location_id
  )
  RETURNING * INTO new_ver;

  RETURN to_jsonb(new_ver);
END;
$function$;
