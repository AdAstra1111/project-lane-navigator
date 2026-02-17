
-- Project Coverage Subjects: what is being covered (a doc version, a bundle, or a whole project)
CREATE TABLE public.project_coverage_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subject_type text NOT NULL, -- 'document_version' | 'bundle' | 'project'
  document_version_id uuid NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  bundle_key text NULL,
  bundle_name text NULL,
  bundle_rules jsonb NULL,
  bundle_document_version_ids jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proj_cov_subjects_project ON public.project_coverage_subjects(project_id);
CREATE INDEX idx_proj_cov_subjects_type ON public.project_coverage_subjects(subject_type);
CREATE UNIQUE INDEX idx_proj_cov_subjects_doc_version ON public.project_coverage_subjects(document_version_id) WHERE document_version_id IS NOT NULL;
CREATE INDEX idx_proj_cov_subjects_bundle ON public.project_coverage_subjects(project_id, bundle_key);

CREATE TRIGGER update_proj_coverage_subjects_updated_at
  BEFORE UPDATE ON public.project_coverage_subjects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.project_coverage_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project coverage subjects"
  ON public.project_coverage_subjects FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert project coverage subjects"
  ON public.project_coverage_subjects FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update project coverage subjects"
  ON public.project_coverage_subjects FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete project coverage subjects"
  ON public.project_coverage_subjects FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Project Coverage Runs: stores coverage results for subjects
CREATE TABLE public.project_coverage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subject_id uuid NOT NULL REFERENCES public.project_coverage_subjects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'completed',
  model text NULL,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  creative_score numeric NULL,
  commercial_score numeric NULL,
  narrative_score numeric NULL,
  confidence numeric NULL,
  risk_flags jsonb NULL,
  contradictions jsonb NULL,
  missing_docs jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_proj_cov_runs_project ON public.project_coverage_runs(project_id, created_at DESC);
CREATE INDEX idx_proj_cov_runs_subject ON public.project_coverage_runs(subject_id, created_at DESC);

ALTER TABLE public.project_coverage_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project coverage runs"
  ON public.project_coverage_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert project coverage runs"
  ON public.project_coverage_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Also drop the coverage_subjects table we accidentally created in previous migration
DROP TABLE IF EXISTS public.coverage_subjects CASCADE;
