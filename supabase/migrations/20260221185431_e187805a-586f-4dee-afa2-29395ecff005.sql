
-- Phase 4.7: Decision Log (scenario_decision_events)

CREATE TABLE IF NOT EXISTS public.scenario_decision_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  scenario_id uuid NULL REFERENCES public.project_scenarios(id) ON DELETE SET NULL,
  previous_scenario_id uuid NULL REFERENCES public.project_scenarios(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_events_project_created
  ON public.scenario_decision_events(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decision_events_project_type_created
  ON public.scenario_decision_events(project_id, event_type, created_at DESC);

ALTER TABLE public.scenario_decision_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "decision_events_select"
  ON public.scenario_decision_events FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "decision_events_insert"
  ON public.scenario_decision_events FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
