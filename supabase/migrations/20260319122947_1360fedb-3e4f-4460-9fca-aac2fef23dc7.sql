
-- Visual Set Curation Loop tables

-- 1. Visual Sets — governed, slot-based set container
CREATE TABLE public.visual_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  domain text NOT NULL DEFAULT 'character_identity',
  target_type text NOT NULL DEFAULT 'character',
  target_id text,
  target_name text NOT NULL DEFAULT '',
  source_run_id text,
  status text NOT NULL DEFAULT 'draft',
  required_slot_count integer NOT NULL DEFAULT 0,
  current_dna_version_id uuid REFERENCES public.character_visual_dna(id),
  locked_at timestamptz,
  locked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visual_sets_project_domain ON public.visual_sets(project_id, domain, target_id);

ALTER TABLE public.visual_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project visual sets"
  ON public.visual_sets FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 2. Visual Set Slots — deterministic slot definitions within a set
CREATE TABLE public.visual_set_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visual_set_id uuid NOT NULL REFERENCES public.visual_sets(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  slot_label text NOT NULL DEFAULT '',
  slot_type text NOT NULL DEFAULT 'image',
  is_required boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'empty',
  selected_image_id uuid,
  evaluation_status text,
  replacement_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visual_set_slots_set_key ON public.visual_set_slots(visual_set_id, slot_key);

ALTER TABLE public.visual_set_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage visual set slots via set access"
  ON public.visual_set_slots FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visual_sets vs 
    WHERE vs.id = visual_set_id 
    AND public.has_project_access(auth.uid(), vs.project_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visual_sets vs 
    WHERE vs.id = visual_set_id 
    AND public.has_project_access(auth.uid(), vs.project_id)
  ));

-- 3. Visual Set Candidates — images attached to slots with producer decisions
CREATE TABLE public.visual_set_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visual_set_slot_id uuid NOT NULL REFERENCES public.visual_set_slots(id) ON DELETE CASCADE,
  image_id uuid NOT NULL,
  evaluation_id uuid,
  selected_for_slot boolean NOT NULL DEFAULT false,
  producer_decision text NOT NULL DEFAULT 'undecided',
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visual_set_candidates_slot_image ON public.visual_set_candidates(visual_set_slot_id, image_id);

ALTER TABLE public.visual_set_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage visual set candidates via slot access"
  ON public.visual_set_candidates FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.visual_set_slots vss
    JOIN public.visual_sets vs ON vs.id = vss.visual_set_id
    WHERE vss.id = visual_set_slot_id
    AND public.has_project_access(auth.uid(), vs.project_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.visual_set_slots vss
    JOIN public.visual_sets vs ON vs.id = vss.visual_set_id
    WHERE vss.id = visual_set_slot_id
    AND public.has_project_access(auth.uid(), vs.project_id)
  ));

-- Trigger to update visual_sets.updated_at
CREATE TRIGGER trg_visual_sets_updated_at
  BEFORE UPDATE ON public.visual_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
