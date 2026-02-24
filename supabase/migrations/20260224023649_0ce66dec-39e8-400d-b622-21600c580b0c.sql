ALTER TABLE public.trailer_rhythm_runs
  ADD COLUMN IF NOT EXISTS hit_points_json jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS beat_hit_intents_json jsonb DEFAULT '[]'::jsonb;