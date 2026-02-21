
-- Stage 7.0: Compilation tracking for Master Season Script

-- Track compilation manifests (append-only audit trail)
CREATE TABLE public.season_master_compilations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  master_document_id uuid NOT NULL,
  master_version_id uuid NOT NULL,
  episode_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  compiled_at timestamptz NOT NULL DEFAULT now(),
  compiled_by uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_season_master_compilations_project ON public.season_master_compilations(project_id);

-- Out-of-date tracking on project_documents for season_master_script docs
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS is_out_of_date boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_compiled_at timestamptz;

-- RLS
ALTER TABLE public.season_master_compilations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project compilations"
  ON public.season_master_compilations FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert compilations for own projects"
  ON public.season_master_compilations FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
