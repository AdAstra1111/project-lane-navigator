
-- Project Title History / Alias Table
CREATE TABLE public.project_title_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  title_type TEXT NOT NULL DEFAULT 'canonical',
  is_current BOOLEAN NOT NULL DEFAULT false,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  change_reason TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_project_title_history_project_id ON public.project_title_history(project_id);
CREATE INDEX idx_project_title_history_normalized ON public.project_title_history(normalized_title);
CREATE INDEX idx_project_title_history_current ON public.project_title_history(project_id, is_current) WHERE is_current = true;

-- RLS
ALTER TABLE public.project_title_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view title history for their projects"
  ON public.project_title_history FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert title history for their projects"
  ON public.project_title_history FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update title history for their projects"
  ON public.project_title_history FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
