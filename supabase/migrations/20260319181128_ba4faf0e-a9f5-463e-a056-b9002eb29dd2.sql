
-- Fix next_scene_version: correct column name from shot_id to scene_id
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
    scene_id, project_id, version_number, status, created_by,
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
