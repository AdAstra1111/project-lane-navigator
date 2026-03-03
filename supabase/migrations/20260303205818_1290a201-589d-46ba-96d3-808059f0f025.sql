ALTER TABLE public.auto_run_jobs
  ADD COLUMN IF NOT EXISTS max_versions_per_doc_per_job integer;