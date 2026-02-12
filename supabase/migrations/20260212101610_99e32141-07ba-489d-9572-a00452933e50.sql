
-- Post-production milestones
CREATE TABLE public.post_milestones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  milestone_type TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  due_date DATE,
  completed_date DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.post_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own post milestones" ON public.post_milestones
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can insert post milestones" ON public.post_milestones
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can update post milestones" ON public.post_milestones
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can delete post milestones" ON public.post_milestones
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_post_milestones_updated_at
  BEFORE UPDATE ON public.post_milestones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Edit versions
CREATE TABLE public.edit_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version_label TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  screening_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.edit_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own edit versions" ON public.edit_versions
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can insert edit versions" ON public.edit_versions
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can update edit versions" ON public.edit_versions
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can delete edit versions" ON public.edit_versions
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- VFX shots
CREATE TABLE public.vfx_shots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  shot_id TEXT NOT NULL DEFAULT '',
  vendor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  due_date DATE,
  complexity TEXT NOT NULL DEFAULT 'medium',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vfx_shots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vfx shots" ON public.vfx_shots
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can insert vfx shots" ON public.vfx_shots
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can update vfx shots" ON public.vfx_shots
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Users can delete vfx shots" ON public.vfx_shots
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_vfx_shots_updated_at
  BEFORE UPDATE ON public.vfx_shots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
