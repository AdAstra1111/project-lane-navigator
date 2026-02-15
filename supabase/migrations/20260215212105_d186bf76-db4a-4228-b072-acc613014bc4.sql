-- Add allow_defaults flag to auto_run_jobs
ALTER TABLE public.auto_run_jobs ADD COLUMN IF NOT EXISTS allow_defaults boolean NOT NULL DEFAULT false;