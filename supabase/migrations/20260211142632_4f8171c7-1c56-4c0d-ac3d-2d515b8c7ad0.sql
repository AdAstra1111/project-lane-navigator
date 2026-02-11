-- Add market value tier to cast members for financeability modeling
ALTER TABLE public.project_cast 
ADD COLUMN market_value_tier text NOT NULL DEFAULT 'unknown';

-- Add comment for documentation
COMMENT ON COLUMN public.project_cast.market_value_tier IS 'Talent market tier: marquee, a-list, b-list, emerging, unknown. Drives cast value multiplier calculations.';
