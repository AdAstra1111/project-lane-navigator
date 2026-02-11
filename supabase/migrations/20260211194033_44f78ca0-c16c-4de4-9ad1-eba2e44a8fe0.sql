
-- Add production-type segmentation and scoring columns to trend_signals
ALTER TABLE public.trend_signals 
  ADD COLUMN IF NOT EXISTS production_type text NOT NULL DEFAULT 'film',
  ADD COLUMN IF NOT EXISTS strength integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS velocity text NOT NULL DEFAULT 'Stable',
  ADD COLUMN IF NOT EXISTS saturation_risk text NOT NULL DEFAULT 'Low',
  ADD COLUMN IF NOT EXISTS forecast text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS budget_tier text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_buyer text NOT NULL DEFAULT '';

-- Add production-type segmentation and scoring columns to cast_trends
ALTER TABLE public.cast_trends
  ADD COLUMN IF NOT EXISTS production_type text NOT NULL DEFAULT 'film',
  ADD COLUMN IF NOT EXISTS strength integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS velocity text NOT NULL DEFAULT 'Stable',
  ADD COLUMN IF NOT EXISTS saturation_risk text NOT NULL DEFAULT 'Low',
  ADD COLUMN IF NOT EXISTS forecast text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS budget_tier text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS target_buyer text NOT NULL DEFAULT '';

-- Index for production_type filtering
CREATE INDEX IF NOT EXISTS idx_trend_signals_production_type ON public.trend_signals (production_type, status);
CREATE INDEX IF NOT EXISTS idx_cast_trends_production_type ON public.cast_trends (production_type, status);
