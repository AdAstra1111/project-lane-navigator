
-- ═══════════════════════════════════════════════════════════════
-- DEVELOPMENT ENGINE V2 — Document-centric versioned loop
-- ═══════════════════════════════════════════════════════════════

-- 1) Extend project_documents with new fields
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS title text DEFAULT '',
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS plaintext text,
  ADD COLUMN IF NOT EXISTS storage_path text;

-- Backfill title from file_name where empty
UPDATE public.project_documents SET title = file_name WHERE title = '' OR title IS NULL;

-- 2) project_document_versions — immutable version chain
CREATE TABLE IF NOT EXISTS public.project_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  label text,
  plaintext text NOT NULL DEFAULT '',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  parent_version_id uuid REFERENCES public.project_document_versions(id),
  change_summary text,
  UNIQUE(document_id, version_number)
);

ALTER TABLE public.project_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view versions of accessible docs"
  ON public.project_document_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_documents pd
      WHERE pd.id = document_id
      AND public.has_project_access(auth.uid(), pd.project_id)
    )
  );

CREATE POLICY "Users can insert versions on accessible docs"
  ON public.project_document_versions FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND EXISTS (
      SELECT 1 FROM public.project_documents pd
      WHERE pd.id = document_id
      AND public.has_project_access(auth.uid(), pd.project_id)
    )
  );

-- 3) development_runs — every AI action logged
CREATE TABLE IF NOT EXISTS public.development_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  run_type text NOT NULL DEFAULT 'ANALYZE',
  production_type text DEFAULT 'narrative_feature',
  strategic_priority text DEFAULT 'BALANCED',
  development_stage text DEFAULT 'IDEA',
  analysis_mode text DEFAULT 'DUAL',
  output_json jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.development_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view runs on accessible projects"
  ON public.development_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create runs on accessible projects"
  ON public.development_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

-- 4) dev_engine_convergence_history — fast chart data
CREATE TABLE IF NOT EXISTS public.dev_engine_convergence_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id uuid NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  creative_score numeric NOT NULL DEFAULT 0,
  greenlight_score numeric NOT NULL DEFAULT 0,
  gap numeric NOT NULL DEFAULT 0,
  allowed_gap numeric DEFAULT 25,
  convergence_status text DEFAULT 'Unknown',
  trajectory text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dev_engine_convergence_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view convergence on accessible projects"
  ON public.dev_engine_convergence_history FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert convergence on accessible projects"
  ON public.dev_engine_convergence_history FOR INSERT
  WITH CHECK (auth.uid() = user_id AND public.has_project_access(auth.uid(), project_id));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_doc_versions_document ON public.project_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_dev_runs_document ON public.development_runs(document_id);
CREATE INDEX IF NOT EXISTS idx_dev_runs_version ON public.development_runs(version_id);
CREATE INDEX IF NOT EXISTS idx_convergence_document ON public.dev_engine_convergence_history(document_id);
CREATE INDEX IF NOT EXISTS idx_convergence_version ON public.dev_engine_convergence_history(version_id);
