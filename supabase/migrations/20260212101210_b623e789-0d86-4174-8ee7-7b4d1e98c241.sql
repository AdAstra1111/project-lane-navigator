
-- Production Daily Reports
CREATE TABLE public.production_daily_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  report_date DATE NOT NULL,
  scenes_shot INTEGER NOT NULL DEFAULT 0,
  pages_shot NUMERIC(5,2) NOT NULL DEFAULT 0,
  setup_count INTEGER NOT NULL DEFAULT 0,
  call_time TEXT NOT NULL DEFAULT '',
  wrap_time TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  incidents TEXT NOT NULL DEFAULT '',
  incident_severity TEXT NOT NULL DEFAULT 'none',
  weather TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, report_date)
);

ALTER TABLE public.production_daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view daily reports for accessible projects"
  ON public.production_daily_reports FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create daily reports for accessible projects"
  ON public.production_daily_reports FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update daily reports for accessible projects"
  ON public.production_daily_reports FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete daily reports for accessible projects"
  ON public.production_daily_reports FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_daily_reports_updated_at
  BEFORE UPDATE ON public.production_daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Production Cost Actuals
CREATE TABLE public.production_cost_actuals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  budgeted NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance NUMERIC(14,2) GENERATED ALWAYS AS (actual - budgeted) STORED,
  variance_pct NUMERIC(7,2) GENERATED ALWAYS AS (
    CASE WHEN budgeted > 0 THEN ROUND(((actual - budgeted) / budgeted) * 100, 2) ELSE 0 END
  ) STORED,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.production_cost_actuals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view cost actuals for accessible projects"
  ON public.production_cost_actuals FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create cost actuals for accessible projects"
  ON public.production_cost_actuals FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update cost actuals for accessible projects"
  ON public.production_cost_actuals FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete cost actuals for accessible projects"
  ON public.production_cost_actuals FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_cost_actuals_updated_at
  BEFORE UPDATE ON public.production_cost_actuals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
