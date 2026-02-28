ALTER TABLE public.auto_run_jobs
  ADD COLUMN IF NOT EXISTS converge_target_json JSONB NOT NULL DEFAULT '{"ci":90,"gp":90}',
  ADD COLUMN IF NOT EXISTS stage_exhaustion_remaining INT NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS stage_exhaustion_default INT NOT NULL DEFAULT 4;