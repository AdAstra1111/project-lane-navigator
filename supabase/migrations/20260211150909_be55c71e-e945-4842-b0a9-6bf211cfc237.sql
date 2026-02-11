
-- Territory cost index: production cost norms by country/region
CREATE TABLE public.territory_cost_index (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  territory TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL DEFAULT 'USD',
  -- Daily rates (USD equivalent)
  crew_day_rate_low NUMERIC NOT NULL DEFAULT 0,
  crew_day_rate_high NUMERIC NOT NULL DEFAULT 0,
  -- Location/stage costs
  stage_day_rate NUMERIC NOT NULL DEFAULT 0,
  location_permit_avg NUMERIC NOT NULL DEFAULT 0,
  -- Living costs
  accommodation_day NUMERIC NOT NULL DEFAULT 0,
  per_diem NUMERIC NOT NULL DEFAULT 0,
  -- Cost index relative to US baseline (1.0 = US)
  cost_index NUMERIC NOT NULL DEFAULT 1.0,
  -- Qualitative
  labor_quality TEXT NOT NULL DEFAULT 'good',
  infrastructure_rating TEXT NOT NULL DEFAULT 'good',
  incentive_headline TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  -- Metadata
  confidence TEXT NOT NULL DEFAULT 'medium',
  source_url TEXT NOT NULL DEFAULT '',
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.territory_cost_index ENABLE ROW LEVEL SECURITY;

-- Read access for authenticated users
CREATE POLICY "Anyone authenticated can view territory costs"
ON public.territory_cost_index FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Service role can manage
CREATE POLICY "Service role can manage territory costs"
ON public.territory_cost_index FOR ALL
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Updated at trigger
CREATE TRIGGER update_territory_cost_index_updated_at
BEFORE UPDATE ON public.territory_cost_index
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
