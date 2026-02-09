
-- Create cast_trends table
CREATE TABLE public.cast_trends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_name TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  age_band TEXT NOT NULL DEFAULT '',
  trend_type TEXT NOT NULL DEFAULT 'Emerging',
  explanation TEXT NOT NULL,
  genre_relevance TEXT[] NOT NULL DEFAULT '{}',
  market_alignment TEXT NOT NULL DEFAULT '',
  cycle_phase TEXT NOT NULL DEFAULT 'Early',
  status TEXT NOT NULL DEFAULT 'active',
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cast_trends ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view
CREATE POLICY "Anyone authenticated can view cast trends"
  ON public.cast_trends FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Service role can manage
CREATE POLICY "Service role can manage cast trends"
  ON public.cast_trends FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Add category column to trend_signals for filtering
-- (already exists per schema, but let's add genre_tags, tone_tags, format_tags, region, lane_relevance for filtering)
ALTER TABLE public.trend_signals
  ADD COLUMN IF NOT EXISTS genre_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tone_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS format_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lane_relevance TEXT[] NOT NULL DEFAULT '{}';
