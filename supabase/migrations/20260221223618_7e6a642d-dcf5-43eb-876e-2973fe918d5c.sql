
-- Script PDF pages (text per page for evidence/page references)
CREATE TABLE public.script_pdf_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  page_number INT NOT NULL,
  page_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.script_pdf_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage script_pdf_pages"
  ON public.script_pdf_pages FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_script_pdf_pages_project_version ON public.script_pdf_pages(project_id, version_id);
CREATE INDEX idx_script_pdf_pages_version_page ON public.script_pdf_pages(version_id, page_number);

-- Script extraction runs
CREATE TABLE public.script_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_version_id UUID NOT NULL REFERENCES public.project_document_versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  output JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.script_extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage script_extraction_runs"
  ON public.script_extraction_runs FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_script_extraction_runs_project ON public.script_extraction_runs(project_id);
