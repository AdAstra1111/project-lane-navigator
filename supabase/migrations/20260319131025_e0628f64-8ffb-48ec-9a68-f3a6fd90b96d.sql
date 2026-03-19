
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
  IF p_force THEN
    DELETE FROM public.scene_graph_snapshots WHERE project_id = p_project_id;
    DELETE FROM public.scene_graph_scenes    WHERE project_id = p_project_id;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_scenes) LOOP
    INSERT INTO public.scene_graph_scenes (project_id, scene_kind, scene_key, created_by)
    VALUES (p_project_id, COALESCE(v_entry->>'scene_kind','narrative'), v_entry->>'scene_key', p_created_by)
    RETURNING * INTO v_scene;

    INSERT INTO public.scene_graph_versions (scene_id, project_id, version_number, status, created_by, slugline, location, time_of_day, content, summary)
    VALUES (v_scene.id, p_project_id, 1, 'draft', p_created_by,
      COALESCE(v_entry->>'slugline',''), COALESCE(v_entry->>'location',''),
      COALESCE(v_entry->>'time_of_day',''), COALESCE(v_entry->>'content',''), COALESCE(v_entry->>'summary',''))
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
$$;

GRANT EXECUTE ON FUNCTION public.scene_graph_atomic_write(uuid, uuid, boolean, jsonb)
  TO authenticated, service_role;
