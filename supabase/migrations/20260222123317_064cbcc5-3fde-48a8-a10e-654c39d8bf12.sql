
-- Add scene_graph_version_id to rewrite_jobs (binds job to exact scene snapshot)
ALTER TABLE public.rewrite_jobs ADD COLUMN IF NOT EXISTS scene_graph_version_id uuid NULL;

-- Add unique constraint on rewrite_jobs for idempotent enqueue
ALTER TABLE public.rewrite_jobs ADD CONSTRAINT uq_rewrite_jobs_version_scene UNIQUE (source_version_id, scene_number);

-- Add composite index for fast claiming (status + scene_number ordering)
CREATE INDEX IF NOT EXISTS idx_rewrite_jobs_claim ON public.rewrite_jobs (project_id, source_version_id, status, scene_number);

-- Ensure project_document_versions has unique constraint on (document_id, version_number)
-- Use DO block to avoid error if constraint already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_pdv_doc_version'
  ) THEN
    ALTER TABLE public.project_document_versions ADD CONSTRAINT uq_pdv_doc_version UNIQUE (document_id, version_number);
  END IF;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
