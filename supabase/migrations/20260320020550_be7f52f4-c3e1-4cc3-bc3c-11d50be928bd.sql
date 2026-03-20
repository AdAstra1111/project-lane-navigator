-- Update bootstrap function to include key_moments as 7th canonical section
CREATE OR REPLACE FUNCTION public.bootstrap_lookbook_sections(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inserted int := 0;
  v_existing int := 0;
  v_sections jsonb := '[
    {"key":"character_identity","label":"Character Identity","order":1},
    {"key":"world_locations","label":"World & Locations","order":2},
    {"key":"atmosphere_lighting","label":"Atmosphere & Lighting","order":3},
    {"key":"texture_detail","label":"Texture & Detail","order":4},
    {"key":"symbolic_motifs","label":"Symbolic Motifs","order":5},
    {"key":"key_moments","label":"Key Moments","order":6},
    {"key":"poster_directions","label":"Poster Directions","order":7}
  ]'::jsonb;
  v_sec jsonb;
BEGIN
  SELECT count(*) INTO v_existing
  FROM public.lookbook_sections WHERE project_id = p_project_id;

  FOR v_sec IN SELECT * FROM jsonb_array_elements(v_sections) LOOP
    INSERT INTO public.lookbook_sections (
      project_id, section_key, section_label, display_order, section_status
    ) VALUES (
      p_project_id,
      v_sec->>'key',
      v_sec->>'label',
      (v_sec->>'order')::int,
      'empty_but_bootstrapped'
    )
    ON CONFLICT (project_id, section_key) DO NOTHING;

    IF FOUND THEN v_inserted := v_inserted + 1; END IF;
  END LOOP;

  -- Update display_order for poster_directions to 7 (was 6)
  UPDATE public.lookbook_sections
  SET display_order = 7
  WHERE project_id = p_project_id AND section_key = 'poster_directions';

  RETURN jsonb_build_object(
    'project_id', p_project_id,
    'inserted', v_inserted,
    'already_existed', v_existing,
    'status', CASE WHEN v_existing > 0 AND v_inserted > 0 THEN 'repaired'
                   WHEN v_existing > 0 THEN 'already_bootstrapped'
                   ELSE 'bootstrapped' END
  );
END;
$$;