
-- Phase 4.1: Scenario Recommendation Engine tables

CREATE TABLE public.scenario_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.project_scenarios(id) ON DELETE CASCADE,
  as_of timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NULL,
  UNIQUE(project_id, scenario_id)
);

CREATE TABLE public.scenario_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recommended_scenario_id uuid NOT NULL REFERENCES public.project_scenarios(id) ON DELETE CASCADE,
  confidence int NOT NULL DEFAULT 50,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  tradeoffs jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenario_scores_project ON public.scenario_scores(project_id);
CREATE INDEX idx_scenario_scores_scenario ON public.scenario_scores(scenario_id);
CREATE INDEX idx_scenario_recommendations_project_created ON public.scenario_recommendations(project_id, created_at DESC);

ALTER TABLE public.scenario_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can read scenario_scores"
  ON public.scenario_scores FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert scenario_scores"
  ON public.scenario_scores FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update scenario_scores"
  ON public.scenario_scores FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can read scenario_recommendations"
  ON public.scenario_recommendations FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert scenario_recommendations"
  ON public.scenario_recommendations FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
