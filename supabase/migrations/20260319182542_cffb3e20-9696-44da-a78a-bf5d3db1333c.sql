
-- Visual Style Authority: canonical style profile per project
CREATE TABLE public.project_visual_style (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  period text NOT NULL DEFAULT '',
  cultural_context text NOT NULL DEFAULT '',
  lighting_philosophy text NOT NULL DEFAULT '',
  camera_philosophy text NOT NULL DEFAULT '',
  composition_philosophy text NOT NULL DEFAULT '',
  texture_materiality text NOT NULL DEFAULT '',
  color_response text NOT NULL DEFAULT '',
  environment_realism text NOT NULL DEFAULT '',
  forbidden_traits text[] NOT NULL DEFAULT '{}',
  is_complete boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE public.project_visual_style ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own project visual style"
  ON public.project_visual_style FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own project visual style"
  ON public.project_visual_style FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update own project visual style"
  ON public.project_visual_style FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER set_updated_at_project_visual_style
  BEFORE UPDATE ON public.project_visual_style
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
