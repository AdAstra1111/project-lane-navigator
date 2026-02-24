
-- Look Bible table for storing visual style constraints
CREATE TABLE public.trailer_look_bibles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'project', -- 'project', 'trailer_run', 'blueprint_run'
  scope_ref_id UUID, -- optional: trailer_script_run_id or blueprint_id
  title TEXT NOT NULL DEFAULT 'Look Bible',
  palette TEXT, -- e.g. "cool cyan shadows, tungsten practicals"
  lighting_style TEXT, -- e.g. "low-key chiaroscuro, warm practicals"
  contrast TEXT, -- e.g. "high contrast, deep blacks"
  camera_language TEXT, -- e.g. "shallow DOF, 35mm grain, anamorphic"
  grain TEXT, -- e.g. "35mm grain, subtle noise"
  color_grade TEXT, -- e.g. "desaturated cool tones"
  reference_assets_notes TEXT, -- freeform notes about reference images/videos
  avoid_list TEXT[], -- e.g. ARRAY['neon','lens flare','dutch angle']
  custom_directives TEXT, -- additional freeform style directives
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS policies
ALTER TABLE public.trailer_look_bibles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view look bibles for accessible projects"
  ON public.trailer_look_bibles FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert look bibles for accessible projects"
  ON public.trailer_look_bibles FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update look bibles for accessible projects"
  ON public.trailer_look_bibles FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete look bibles for accessible projects"
  ON public.trailer_look_bibles FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Index for fast lookup
CREATE INDEX idx_trailer_look_bibles_project_scope ON public.trailer_look_bibles(project_id, scope);

-- Updated_at trigger
CREATE TRIGGER set_trailer_look_bibles_updated_at
  BEFORE UPDATE ON public.trailer_look_bibles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
