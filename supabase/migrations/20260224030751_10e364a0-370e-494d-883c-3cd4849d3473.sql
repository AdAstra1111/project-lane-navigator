
ALTER TABLE public.trailer_rhythm_runs
  ADD COLUMN IF NOT EXISTS audio_plan_json jsonb DEFAULT NULL;
