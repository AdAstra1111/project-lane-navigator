
-- Animatics table
CREATE TABLE public.animatics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shot_list_id uuid NOT NULL REFERENCES public.shot_lists(id) ON DELETE CASCADE,
  episode_number int,
  scope jsonb DEFAULT '{"mode":"scene"}'::jsonb,
  fps int DEFAULT 24,
  aspect_ratio text DEFAULT '16:9',
  status text DEFAULT 'draft',
  render_asset_path text,
  timing_asset_path text,
  created_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_at timestamptz DEFAULT now()
);

-- Animatic panels table
CREATE TABLE public.animatic_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  animatic_id uuid NOT NULL REFERENCES public.animatics(id) ON DELETE CASCADE,
  storyboard_board_id uuid NOT NULL REFERENCES public.storyboard_boards(id) ON DELETE CASCADE,
  scene_number text NOT NULL DEFAULT '',
  shot_number int NOT NULL DEFAULT 0,
  order_index int NOT NULL DEFAULT 0,
  duration_seconds numeric NOT NULL DEFAULT 2.0,
  transition text DEFAULT 'cut',
  locked boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Animatic markers table
CREATE TABLE public.animatic_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  animatic_id uuid NOT NULL REFERENCES public.animatics(id) ON DELETE CASCADE,
  time_seconds numeric NOT NULL DEFAULT 0,
  marker_type text NOT NULL DEFAULT 'note',
  text text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id)
);

-- Updated_at triggers
CREATE TRIGGER set_animatics_updated_at BEFORE UPDATE ON public.animatics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_animatic_panels_updated_at BEFORE UPDATE ON public.animatic_panels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.animatics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animatic_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.animatic_markers ENABLE ROW LEVEL SECURITY;

-- Animatics: project members can CRUD
CREATE POLICY "animatics_select" ON public.animatics FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "animatics_insert" ON public.animatics FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "animatics_update" ON public.animatics FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "animatics_delete" ON public.animatics FOR DELETE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Animatic panels: via animatic's project
CREATE POLICY "animatic_panels_select" ON public.animatic_panels FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));
CREATE POLICY "animatic_panels_insert" ON public.animatic_panels FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));
CREATE POLICY "animatic_panels_update" ON public.animatic_panels FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));
CREATE POLICY "animatic_panels_delete" ON public.animatic_panels FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));

-- Animatic markers: via animatic's project
CREATE POLICY "animatic_markers_select" ON public.animatic_markers FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));
CREATE POLICY "animatic_markers_insert" ON public.animatic_markers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));
CREATE POLICY "animatic_markers_update" ON public.animatic_markers FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));
CREATE POLICY "animatic_markers_delete" ON public.animatic_markers FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.animatics a WHERE a.id = animatic_id AND public.has_project_access(auth.uid(), a.project_id)));

-- Indexes
CREATE INDEX idx_animatics_project ON public.animatics(project_id);
CREATE INDEX idx_animatics_shot_list ON public.animatics(shot_list_id);
CREATE INDEX idx_animatic_panels_animatic ON public.animatic_panels(animatic_id);
CREATE INDEX idx_animatic_panels_board ON public.animatic_panels(storyboard_board_id);
CREATE INDEX idx_animatic_markers_animatic ON public.animatic_markers(animatic_id);
