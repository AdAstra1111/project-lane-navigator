
-- Versioned budgets per project
CREATE TABLE public.project_budgets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version_label TEXT NOT NULL DEFAULT 'Budget v1',
  total_amount NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  lane_template TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'native',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Budget line items
CREATE TABLE public.project_budget_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  budget_id UUID NOT NULL REFERENCES public.project_budgets(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  line_name TEXT NOT NULL DEFAULT '',
  amount NUMERIC NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_budget_lines ENABLE ROW LEVEL SECURITY;

-- RLS policies for project_budgets
CREATE POLICY "Project members can view budgets" ON public.project_budgets
  FOR SELECT USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create budgets" ON public.project_budgets
  FOR INSERT WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update budgets" ON public.project_budgets
  FOR UPDATE USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete budgets" ON public.project_budgets
  FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- RLS policies for project_budget_lines
CREATE POLICY "Project members can view budget lines" ON public.project_budget_lines
  FOR SELECT USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create budget lines" ON public.project_budget_lines
  FOR INSERT WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update budget lines" ON public.project_budget_lines
  FOR UPDATE USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete budget lines" ON public.project_budget_lines
  FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- Triggers for updated_at
CREATE TRIGGER update_project_budgets_updated_at
  BEFORE UPDATE ON public.project_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_budget_lines_updated_at
  BEFORE UPDATE ON public.project_budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
