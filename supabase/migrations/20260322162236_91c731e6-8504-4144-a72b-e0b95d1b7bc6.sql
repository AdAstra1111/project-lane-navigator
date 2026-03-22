
-- Phase 9B: Cast Regeneration Job Queue
-- Dedicated table for cast-drift regeneration jobs.
-- Separate from existing regen_jobs (document-oriented) to avoid schema overloading.

CREATE TABLE public.cast_regen_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  character_key text NOT NULL,
  output_id uuid NOT NULL,
  output_type text NOT NULL DEFAULT 'ai_generated_media',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_message text
);

-- Prevent duplicate queued/running jobs for same output+reason
CREATE UNIQUE INDEX idx_cast_regen_jobs_active_dedup
  ON public.cast_regen_jobs (project_id, output_id, reason)
  WHERE status IN ('queued', 'running');

-- Query indexes
CREATE INDEX idx_cast_regen_jobs_project ON public.cast_regen_jobs (project_id, created_at DESC);
CREATE INDEX idx_cast_regen_jobs_status ON public.cast_regen_jobs (project_id, status);

-- RLS
ALTER TABLE public.cast_regen_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cast_regen_jobs_owner_read" ON public.cast_regen_jobs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = cast_regen_jobs.project_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "cast_regen_jobs_owner_insert" ON public.cast_regen_jobs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = cast_regen_jobs.project_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "cast_regen_jobs_owner_update" ON public.cast_regen_jobs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = cast_regen_jobs.project_id
      AND p.user_id = auth.uid()
    )
  );
