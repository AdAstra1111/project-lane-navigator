-- Canonical Lookbook Sections table
CREATE TABLE public.lookbook_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  section_key text NOT NULL,
  section_label text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  section_status text NOT NULL DEFAULT 'empty_but_bootstrapped',
  pack_count integer NOT NULL DEFAULT 0,
  slot_count integer NOT NULL DEFAULT 0,
  readiness_state text NOT NULL DEFAULT 'not_started',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, section_key),
  CONSTRAINT valid_section_key CHECK (section_key IN (
    'character_identity', 'world_locations', 'atmosphere_lighting',
    'texture_detail', 'symbolic_motifs', 'poster_directions'
  )),
  CONSTRAINT valid_section_status CHECK (section_status IN (
    'valid', 'empty_but_bootstrapped', 'partially_populated',
    'fully_populated', 'invalid_structure', 'repaired'
  )),
  CONSTRAINT valid_readiness CHECK (readiness_state IN (
    'not_started', 'upstream_missing', 'ready_to_populate', 'populated', 'complete'
  ))
);

ALTER TABLE public.lookbook_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own lookbook sections"
  ON public.lookbook_sections FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own lookbook sections"
  ON public.lookbook_sections FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own lookbook sections"
  ON public.lookbook_sections FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete own lookbook sections"
  ON public.lookbook_sections FOR DELETE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER lookbook_sections_updated_at
  BEFORE UPDATE ON public.lookbook_sections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Bootstrap function: idempotently seeds all 6 canonical sections
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
    {"key":"poster_directions","label":"Poster Directions","order":6}
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