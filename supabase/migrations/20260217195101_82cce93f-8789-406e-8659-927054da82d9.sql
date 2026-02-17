
-- Active Project Folder: stores the canonical active (approved) doc version per project per doc_type_key
CREATE TABLE public.project_active_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_type_key text NOT NULL,
  document_version_id uuid NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  approved_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid NULL,
  source_flow text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one active doc per type per project
CREATE UNIQUE INDEX project_active_docs_unique ON public.project_active_docs(project_id, doc_type_key);
CREATE INDEX project_active_docs_project_idx ON public.project_active_docs(project_id);
CREATE INDEX project_active_docs_version_idx ON public.project_active_docs(document_version_id);

CREATE TRIGGER update_project_active_docs_updated_at
  BEFORE UPDATE ON public.project_active_docs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.project_active_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view active docs for accessible projects"
  ON public.project_active_docs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert active docs for accessible projects"
  ON public.project_active_docs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update active docs for accessible projects"
  ON public.project_active_docs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete active docs for accessible projects"
  ON public.project_active_docs FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
