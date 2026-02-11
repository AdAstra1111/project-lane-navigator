
-- Recoupment waterfall scenarios
CREATE TABLE public.project_recoupment_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  scenario_name TEXT NOT NULL DEFAULT 'Base Case',
  total_revenue_estimate NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_recoupment_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view recoupment scenarios"
  ON public.project_recoupment_scenarios FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create recoupment scenarios"
  ON public.project_recoupment_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update recoupment scenarios"
  ON public.project_recoupment_scenarios FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete recoupment scenarios"
  ON public.project_recoupment_scenarios FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_recoupment_scenarios_updated_at
  BEFORE UPDATE ON public.project_recoupment_scenarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Recoupment waterfall tiers (ordered tranches within a scenario)
CREATE TABLE public.project_recoupment_tiers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES public.project_recoupment_scenarios(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tier_order INTEGER NOT NULL DEFAULT 0,
  participant_name TEXT NOT NULL DEFAULT '',
  tier_type TEXT NOT NULL DEFAULT 'recoup',
  percentage NUMERIC NOT NULL DEFAULT 0,
  fixed_amount NUMERIC NOT NULL DEFAULT 0,
  cap NUMERIC,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_recoupment_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view recoupment tiers"
  ON public.project_recoupment_tiers FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create recoupment tiers"
  ON public.project_recoupment_tiers FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update recoupment tiers"
  ON public.project_recoupment_tiers FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete recoupment tiers"
  ON public.project_recoupment_tiers FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

CREATE TRIGGER update_recoupment_tiers_updated_at
  BEFORE UPDATE ON public.project_recoupment_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
