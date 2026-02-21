
-- Visual reference sets (characters, locations, styles)
CREATE TABLE public.visual_reference_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ref_type TEXT NOT NULL DEFAULT 'character',
  name TEXT NOT NULL DEFAULT '',
  description TEXT,
  data JSONB,
  is_default BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.visual_reference_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage visual reference sets"
  ON public.visual_reference_sets FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_visual_ref_sets_project ON public.visual_reference_sets(project_id);

-- Visual reference assets (images for ref sets)
CREATE TABLE public.visual_reference_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reference_set_id UUID NOT NULL REFERENCES public.visual_reference_sets(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  width INT,
  height INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.visual_reference_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage visual reference assets"
  ON public.visual_reference_assets FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_visual_ref_assets_set ON public.visual_reference_assets(reference_set_id);

-- Extend storyboard_boards with ref fields
ALTER TABLE public.storyboard_boards
  ADD COLUMN character_refs JSONB,
  ADD COLUMN location_refs JSONB,
  ADD COLUMN style_preset_id UUID,
  ADD COLUMN scene_seed TEXT,
  ADD COLUMN board_seed TEXT,
  ADD COLUMN continuity_lock BOOLEAN NOT NULL DEFAULT false;

-- Updated at triggers
CREATE TRIGGER set_visual_ref_sets_updated_at
  BEFORE UPDATE ON public.visual_reference_sets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
