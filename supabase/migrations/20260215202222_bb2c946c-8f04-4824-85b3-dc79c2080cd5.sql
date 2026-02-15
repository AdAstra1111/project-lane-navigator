
-- Add human approval gate fields to auto_run_jobs
ALTER TABLE public.auto_run_jobs
  ADD COLUMN IF NOT EXISTS awaiting_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_type text,
  ADD COLUMN IF NOT EXISTS approval_payload jsonb,
  ADD COLUMN IF NOT EXISTS pending_doc_id uuid,
  ADD COLUMN IF NOT EXISTS pending_version_id uuid,
  ADD COLUMN IF NOT EXISTS pending_doc_type text,
  ADD COLUMN IF NOT EXISTS pending_next_doc_type text;
