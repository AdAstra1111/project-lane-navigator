
-- Phase 4.2: scenario_stress_tests table
CREATE TABLE public.scenario_stress_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.project_scenarios(id) ON DELETE CASCADE,
  base_projection_id uuid NULL REFERENCES public.scenario_projections(id) ON DELETE SET NULL,
  grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  results jsonb NOT NULL DEFAULT '{}'::jsonb,
  fragility_score int NOT NULL DEFAULT 50,
  volatility_index int NOT NULL DEFAULT 50,
  breakpoints jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_stress_tests_project_scenario ON public.scenario_stress_tests (project_id, scenario_id, created_at DESC);

ALTER TABLE public.scenario_stress_tests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view stress tests for their projects"
  ON public.scenario_stress_tests FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert stress tests for their projects"
  ON public.scenario_stress_tests FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update stress tests for their projects"
  ON public.scenario_stress_tests FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete stress tests for their projects"
  ON public.scenario_stress_tests FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
