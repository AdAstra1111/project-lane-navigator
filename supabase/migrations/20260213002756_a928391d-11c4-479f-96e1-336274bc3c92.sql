
-- Company Intelligence Profiles table
CREATE TABLE public.company_intelligence_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES public.production_companies(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  mode_name TEXT NOT NULL DEFAULT 'Company Mode',
  budget_sweet_spot_min NUMERIC DEFAULT 0,
  budget_sweet_spot_max NUMERIC DEFAULT 0,
  genre_bias_list TEXT[] DEFAULT '{}',
  streamer_bias_list TEXT[] DEFAULT '{}',
  packaging_strength TEXT NOT NULL DEFAULT 'Moderate' CHECK (packaging_strength IN ('Low', 'Moderate', 'Strong')),
  finance_tolerance TEXT NOT NULL DEFAULT 'Balanced' CHECK (finance_tolerance IN ('Conservative', 'Balanced', 'Aggressive')),
  attachment_tier_range TEXT NOT NULL DEFAULT 'Mid' CHECK (attachment_tier_range IN ('Emerging', 'Mid', 'A-List')),
  series_track_record TEXT NOT NULL DEFAULT 'None' CHECK (series_track_record IN ('None', 'Emerging', 'Established')),
  strategic_priorities TEXT DEFAULT '',
  bias_weighting_modifier NUMERIC NOT NULL DEFAULT 1.0 CHECK (bias_weighting_modifier >= 0 AND bias_weighting_modifier <= 2),
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.company_intelligence_profiles ENABLE ROW LEVEL SECURITY;

-- Users can see profiles for companies they belong to
CREATE POLICY "Users can view own company profiles"
  ON public.company_intelligence_profiles FOR SELECT
  USING (
    created_by = auth.uid()
    OR company_id IN (
      SELECT id FROM public.production_companies WHERE user_id = auth.uid()
    )
    OR company_id IN (
      SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own company profiles"
  ON public.company_intelligence_profiles FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own company profiles"
  ON public.company_intelligence_profiles FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Users can delete own company profiles"
  ON public.company_intelligence_profiles FOR DELETE
  USING (created_by = auth.uid());

-- Add active company profile to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS active_company_profile_id UUID REFERENCES public.company_intelligence_profiles(id) ON DELETE SET NULL;

-- Trigger for updated_at
CREATE TRIGGER update_company_intelligence_profiles_updated_at
  BEFORE UPDATE ON public.company_intelligence_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
