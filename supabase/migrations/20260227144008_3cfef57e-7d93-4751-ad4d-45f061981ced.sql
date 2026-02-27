ALTER TABLE public.auto_run_jobs
  ADD COLUMN IF NOT EXISTS is_processing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz NULL;