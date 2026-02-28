ALTER TABLE public.auto_run_jobs 
  ADD COLUMN IF NOT EXISTS last_analyzed_version_id UUID DEFAULT NULL;