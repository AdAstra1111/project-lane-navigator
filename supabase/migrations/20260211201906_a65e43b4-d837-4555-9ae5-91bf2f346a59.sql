-- Add production_type column to trend_weekly_briefs
ALTER TABLE public.trend_weekly_briefs
ADD COLUMN production_type text NOT NULL DEFAULT 'film';

-- Create index for faster lookups
CREATE INDEX idx_trend_weekly_briefs_production_type ON public.trend_weekly_briefs (production_type, week_start DESC);
