
-- =============================================
-- Incentive Programs (AI-researched, cached)
-- =============================================
CREATE TABLE public.incentive_programs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  jurisdiction TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'credit', -- credit / rebate / grant / fund
  headline_rate TEXT NOT NULL DEFAULT '',
  qualifying_spend_rules TEXT NOT NULL DEFAULT '',
  caps_limits TEXT NOT NULL DEFAULT '',
  formats_supported TEXT[] NOT NULL DEFAULT '{}',
  payment_timing TEXT NOT NULL DEFAULT '',
  stackability TEXT NOT NULL DEFAULT '',
  eligibility_summary TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  last_verified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  confidence TEXT NOT NULL DEFAULT 'medium', -- high / medium / low
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.incentive_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view incentive programs"
  ON public.incentive_programs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage incentive programs"
  ON public.incentive_programs FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER update_incentive_programs_updated_at
  BEFORE UPDATE ON public.incentive_programs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Co-Production Frameworks
-- =============================================
CREATE TABLE public.copro_frameworks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'treaty', -- treaty / convention / fund
  eligible_countries TEXT[] NOT NULL DEFAULT '{}',
  min_share_pct REAL,
  max_share_pct REAL,
  cultural_requirements TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  last_verified_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  confidence TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.copro_frameworks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view copro frameworks"
  ON public.copro_frameworks FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Service role can manage copro frameworks"
  ON public.copro_frameworks FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER update_copro_frameworks_updated_at
  BEFORE UPDATE ON public.copro_frameworks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Project Incentive Scenarios (per-project)
-- =============================================
CREATE TABLE public.project_incentive_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  incentive_program_id UUID REFERENCES public.incentive_programs(id) ON DELETE SET NULL,
  jurisdiction TEXT NOT NULL DEFAULT '',
  estimated_qualifying_spend TEXT NOT NULL DEFAULT '',
  estimated_benefit TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT 'medium',
  blockers TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_incentive_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own incentive scenarios"
  ON public.project_incentive_scenarios FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own incentive scenarios"
  ON public.project_incentive_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own incentive scenarios"
  ON public.project_incentive_scenarios FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own incentive scenarios"
  ON public.project_incentive_scenarios FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_project_incentive_scenarios_updated_at
  BEFORE UPDATE ON public.project_incentive_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- Project Co-Production Scenarios (per-project)
-- =============================================
CREATE TABLE public.project_copro_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  copro_framework_id UUID REFERENCES public.copro_frameworks(id) ON DELETE SET NULL,
  proposed_splits JSONB NOT NULL DEFAULT '{}',
  eligibility_status TEXT NOT NULL DEFAULT 'uncertain', -- eligible / uncertain / not_eligible
  contributions TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.project_copro_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own copro scenarios"
  ON public.project_copro_scenarios FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own copro scenarios"
  ON public.project_copro_scenarios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own copro scenarios"
  ON public.project_copro_scenarios FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own copro scenarios"
  ON public.project_copro_scenarios FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_project_copro_scenarios_updated_at
  BEFORE UPDATE ON public.project_copro_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
