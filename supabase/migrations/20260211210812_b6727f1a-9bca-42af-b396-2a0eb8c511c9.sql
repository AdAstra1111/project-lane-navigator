-- Add intelligence_layer column to trend_engines
ALTER TABLE public.trend_engines 
ADD COLUMN intelligence_layer text NOT NULL DEFAULT 'market';

-- Add enabled column for admin governance
ALTER TABLE public.trend_engines
ADD COLUMN enabled boolean NOT NULL DEFAULT true;

-- Update existing engines with correct layer classifications
-- Market Intelligence Layer
UPDATE public.trend_engines SET intelligence_layer = 'market' WHERE engine_name IN (
  'Box Office ROI', 'Streamer Appetite Index', 'Budget Inflation Tracker',
  'Exportability Score', 'Financing Climate Monitor', 'Event Monetisation Forecast',
  'Territory Incentive Tracker', 'Platform Revenue Velocity', 'App Store Ranking Momentum'
);

-- Narrative Intelligence Layer
UPDATE public.trend_engines SET intelligence_layer = 'narrative' WHERE engine_name IN (
  'Genre Cycle Engine', 'IP Familiarity Index', 'Festival Heat Predictor',
  'Format Repeatability', 'Cross-Media Adaptability', 'Social Engagement Velocity',
  'Micro-Genre Heat Index', 'Episodic Hook Pattern Analyzer', 'Cadence Optimization Model'
);

-- Talent Intelligence Layer
UPDATE public.trend_engines SET intelligence_layer = 'talent' WHERE engine_name IN (
  'Talent Heat Index', 'Influencer Conversion Index'
);

-- Platform & Distribution Intelligence Layer
UPDATE public.trend_engines SET intelligence_layer = 'platform' WHERE engine_name IN (
  'Retention Proxy Model', 'Localization Scaling Potential'
);

-- Create engine weight snapshots table for model versioning
CREATE TABLE public.engine_weight_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  snapshot_label text NOT NULL DEFAULT '',
  production_type text NOT NULL,
  weights jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger_type text NOT NULL DEFAULT 'manual',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engine_weight_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view snapshots"
ON public.engine_weight_snapshots FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Anyone authenticated can create snapshots"
ON public.engine_weight_snapshots FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Add index for fast lookups
CREATE INDEX idx_weight_snapshots_type ON public.engine_weight_snapshots(production_type, created_at DESC);