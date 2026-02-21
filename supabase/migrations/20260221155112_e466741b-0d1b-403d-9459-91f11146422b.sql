
CREATE TABLE public.scenario_projections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario_id UUID NOT NULL REFERENCES public.project_scenarios(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  months INTEGER NOT NULL DEFAULT 12,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  series JSONB NOT NULL DEFAULT '[]'::jsonb,
  projection_risk_score NUMERIC NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_projections_lookup ON public.scenario_projections (project_id, scenario_id, created_at DESC);

ALTER TABLE public.scenario_projections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view projections for accessible projects"
  ON public.scenario_projections FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert projections for accessible projects"
  ON public.scenario_projections FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);

CREATE POLICY "Users can delete own projections"
  ON public.scenario_projections FOR DELETE
  USING (auth.uid() = user_id);
