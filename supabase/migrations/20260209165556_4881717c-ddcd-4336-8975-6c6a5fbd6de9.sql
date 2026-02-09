
-- ============================================
-- PROJECT CAST (wishlist → attached talent)
-- ============================================
CREATE TABLE public.project_cast (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role_name TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'wishlist',
  territory_tags TEXT[] NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_cast ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own project cast" ON public.project_cast FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own project cast" ON public.project_cast FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own project cast" ON public.project_cast FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own project cast" ON public.project_cast FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_cast_updated_at BEFORE UPDATE ON public.project_cast FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PROJECT PARTNERS (sales agents, co-producers, etc.)
-- ============================================
CREATE TABLE public.project_partners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  partner_name TEXT NOT NULL DEFAULT '',
  partner_type TEXT NOT NULL DEFAULT 'co-producer',
  status TEXT NOT NULL DEFAULT 'identified',
  territory TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own project partners" ON public.project_partners FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own project partners" ON public.project_partners FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own project partners" ON public.project_partners FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own project partners" ON public.project_partners FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_partners_updated_at BEFORE UPDATE ON public.project_partners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PROJECT SCRIPTS (versioning)
-- ============================================
CREATE TABLE public.project_scripts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  version_label TEXT NOT NULL DEFAULT 'Draft 1',
  status TEXT NOT NULL DEFAULT 'current',
  file_path TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own project scripts" ON public.project_scripts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own project scripts" ON public.project_scripts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own project scripts" ON public.project_scripts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own project scripts" ON public.project_scripts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_scripts_updated_at BEFORE UPDATE ON public.project_scripts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PROJECT FINANCE SCENARIOS
-- ============================================
CREATE TABLE public.project_finance_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  scenario_name TEXT NOT NULL DEFAULT 'Scenario 1',
  total_budget TEXT NOT NULL DEFAULT '',
  incentive_amount TEXT NOT NULL DEFAULT '',
  presales_amount TEXT NOT NULL DEFAULT '',
  equity_amount TEXT NOT NULL DEFAULT '',
  gap_amount TEXT NOT NULL DEFAULT '',
  other_sources TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'medium',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_finance_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own finance scenarios" ON public.project_finance_scenarios FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own finance scenarios" ON public.project_finance_scenarios FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own finance scenarios" ON public.project_finance_scenarios FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own finance scenarios" ON public.project_finance_scenarios FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_project_finance_scenarios_updated_at BEFORE UPDATE ON public.project_finance_scenarios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- PROJECT UPDATES TIMELINE
-- ============================================
CREATE TABLE public.project_updates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  update_type TEXT NOT NULL DEFAULT 'note',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  impact_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own project updates" ON public.project_updates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create their own project updates" ON public.project_updates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own project updates" ON public.project_updates FOR DELETE USING (auth.uid() = user_id);
