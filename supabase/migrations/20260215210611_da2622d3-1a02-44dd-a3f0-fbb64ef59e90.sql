
ALTER TABLE public.auto_run_jobs
  ADD COLUMN follow_latest boolean NOT NULL DEFAULT true,
  ADD COLUMN resume_document_id uuid NULL,
  ADD COLUMN resume_version_id uuid NULL;
