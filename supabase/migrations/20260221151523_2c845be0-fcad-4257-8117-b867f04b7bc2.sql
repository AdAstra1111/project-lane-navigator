
-- Phase 1.5: Active Scenario Authority

-- A) project_state_graphs: active scenario tracking
ALTER TABLE public.project_state_graphs
  ADD COLUMN IF NOT EXISTS active_scenario_id uuid NULL REFERENCES public.project_scenarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS active_scenario_set_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS active_scenario_set_by uuid NULL;

CREATE INDEX IF NOT EXISTS idx_state_graphs_active_scenario
  ON public.project_state_graphs(project_id, active_scenario_id);

-- B) project_scenarios: is_active flag (boolean, not enum)
-- is_active may already exist from earlier migration; use IF NOT EXISTS pattern via DO block
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'project_scenarios' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.project_scenarios ADD COLUMN is_active boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scenarios_project_is_active
  ON public.project_scenarios(project_id, is_active);

CREATE INDEX IF NOT EXISTS idx_scenarios_project_type_active
  ON public.project_scenarios(project_id, scenario_type, is_active);
