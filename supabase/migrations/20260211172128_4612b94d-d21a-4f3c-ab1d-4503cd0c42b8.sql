
-- Cashflow sources table: persists inflow/outflow line items per project
CREATE TABLE public.project_cashflow_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'outflow', -- 'inflow' or 'outflow'
  amount NUMERIC NOT NULL DEFAULT 0,
  start_month INTEGER NOT NULL DEFAULT 0,
  duration_months INTEGER NOT NULL DEFAULT 1,
  timing TEXT NOT NULL DEFAULT 'monthly', -- 'upfront', 'monthly', 'backend', 'milestone'
  origin TEXT NOT NULL DEFAULT 'manual', -- 'manual', 'deal-sync', 'budget-sync', 'schedule-sync', 'incentive-sync'
  origin_ref_id UUID, -- optional reference to the source deal/budget/etc
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_cashflow_sources ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Project members can view cashflow sources"
  ON public.project_cashflow_sources FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create cashflow sources"
  ON public.project_cashflow_sources FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update cashflow sources"
  ON public.project_cashflow_sources FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete cashflow sources"
  ON public.project_cashflow_sources FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Trigger for updated_at
CREATE TRIGGER update_project_cashflow_sources_updated_at
  BEFORE UPDATE ON public.project_cashflow_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Activity logging
CREATE TRIGGER log_cashflow_source_activity
  AFTER INSERT OR UPDATE OR DELETE ON public.project_cashflow_sources
  FOR EACH ROW EXECUTE FUNCTION public.log_project_activity();
