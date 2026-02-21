
-- ============================================
-- PROJECT STATE GRAPHS (canonical 5-layer state)
-- ============================================
CREATE TABLE public.project_state_graphs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  creative_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  execution_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  production_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  finance_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  revenue_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_bands jsonb NOT NULL DEFAULT '{}'::jsonb,
  assumption_multipliers jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_cascade_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE INDEX idx_state_graphs_project ON public.project_state_graphs(project_id);

CREATE TRIGGER set_state_graphs_updated_at
  BEFORE UPDATE ON public.project_state_graphs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.project_state_graphs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "state_graphs_select" ON public.project_state_graphs
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "state_graphs_insert" ON public.project_state_graphs
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "state_graphs_update" ON public.project_state_graphs
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "state_graphs_delete" ON public.project_state_graphs
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- ============================================
-- PROJECT SCENARIOS (baseline + custom + system-generated)
-- ============================================
CREATE TABLE public.project_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'Baseline',
  scenario_type text NOT NULL DEFAULT 'baseline', -- 'baseline' | 'system' | 'custom'
  is_active boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  description text NULL,
  state_overrides jsonb NOT NULL DEFAULT '{}'::jsonb, -- partial overrides per layer
  computed_state jsonb NOT NULL DEFAULT '{}'::jsonb, -- full resolved state after cascade
  delta_vs_baseline jsonb NOT NULL DEFAULT '{}'::jsonb, -- diff from baseline
  coherence_flags jsonb NOT NULL DEFAULT '[]'::jsonb, -- inconsistency warnings
  override_log jsonb NOT NULL DEFAULT '[]'::jsonb, -- decision audit trail
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scenarios_project ON public.project_scenarios(project_id, scenario_type);
CREATE INDEX idx_scenarios_active ON public.project_scenarios(project_id, is_active) WHERE is_active = true;

CREATE TRIGGER set_scenarios_updated_at
  BEFORE UPDATE ON public.project_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.project_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scenarios_select" ON public.project_scenarios
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "scenarios_insert" ON public.project_scenarios
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "scenarios_update" ON public.project_scenarios
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "scenarios_delete" ON public.project_scenarios
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- ============================================
-- SCENARIO SNAPSHOTS (historical cascade results)
-- ============================================
CREATE TABLE public.scenario_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES public.project_scenarios(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  trigger_reason text NOT NULL DEFAULT 'manual', -- 'manual' | 'cascade' | 'override' | 'drift'
  snapshot_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta_vs_previous jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_bands jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_scenario ON public.scenario_snapshots(scenario_id, created_at DESC);
CREATE INDEX idx_snapshots_project ON public.scenario_snapshots(project_id);

ALTER TABLE public.scenario_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select" ON public.scenario_snapshots
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "snapshots_insert" ON public.scenario_snapshots
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- ============================================
-- DRIFT ALERTS (threshold-based notifications)
-- ============================================
CREATE TABLE public.drift_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scenario_id uuid NULL REFERENCES public.project_scenarios(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  alert_type text NOT NULL, -- 'budget_drift' | 'schedule_drift' | 'revenue_risk' | 'coherence_break'
  severity text NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  layer text NOT NULL, -- which state layer triggered
  metric_key text NOT NULL,
  previous_value numeric NULL,
  current_value numeric NULL,
  threshold numeric NULL,
  message text NOT NULL,
  acknowledged boolean NOT NULL DEFAULT false,
  acknowledged_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_drift_alerts_project ON public.drift_alerts(project_id, created_at DESC);
CREATE INDEX idx_drift_alerts_unacked ON public.drift_alerts(project_id, acknowledged) WHERE acknowledged = false;

ALTER TABLE public.drift_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drift_alerts_select" ON public.drift_alerts
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "drift_alerts_insert" ON public.drift_alerts
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "drift_alerts_update" ON public.drift_alerts
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
