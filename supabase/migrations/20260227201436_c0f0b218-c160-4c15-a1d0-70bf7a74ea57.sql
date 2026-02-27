
-- Add job_type column to regen_jobs for series script generation
ALTER TABLE public.regen_jobs
  ADD COLUMN IF NOT EXISTS job_type text NOT NULL DEFAULT 'regen_docs';

-- Add episode-specific columns to regen_job_items
ALTER TABLE public.regen_job_items
  ADD COLUMN IF NOT EXISTS episode_index int,
  ADD COLUMN IF NOT EXISTS episode_title text,
  ADD COLUMN IF NOT EXISTS target_doc_type text,
  ADD COLUMN IF NOT EXISTS meta_json jsonb DEFAULT '{}'::jsonb;

-- Add meta_json to project_documents for per-episode metadata
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS meta_json jsonb DEFAULT '{}'::jsonb;

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_regen_job_items_job_status ON public.regen_job_items(job_id, status);
CREATE INDEX IF NOT EXISTS idx_regen_job_items_episode ON public.regen_job_items(job_id, episode_index);
CREATE INDEX IF NOT EXISTS idx_regen_jobs_job_type ON public.regen_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_project_documents_meta ON public.project_documents USING gin(meta_json);
