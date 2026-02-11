
-- Create cost entries table for tracking actual spend against budget
CREATE TABLE public.project_cost_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  budget_id UUID REFERENCES public.project_budgets(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor TEXT NOT NULL DEFAULT '',
  receipt_ref TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_cost_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view cost entries"
  ON public.project_cost_entries FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create cost entries"
  ON public.project_cost_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update cost entries"
  ON public.project_cost_entries FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete cost entries"
  ON public.project_cost_entries FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_project_cost_entries_updated_at
  BEFORE UPDATE ON public.project_cost_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_project_cost_entries_project ON public.project_cost_entries(project_id);
CREATE INDEX idx_project_cost_entries_budget ON public.project_cost_entries(budget_id);
