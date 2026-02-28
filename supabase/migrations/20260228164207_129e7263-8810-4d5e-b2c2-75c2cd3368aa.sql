
-- project_comparables: persistent extracted/manual comparable titles per project
CREATE TABLE public.project_comparables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  kind text, -- film/series/vertical/unknown
  source text NOT NULL DEFAULT 'manual', -- project_docs, manual, external_search
  source_doc_id uuid REFERENCES public.project_documents(id) ON DELETE SET NULL,
  source_version_id uuid,
  raw_text text,
  normalized_title text NOT NULL,
  confidence numeric,
  extraction_meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, normalized_title)
);

-- RLS
ALTER TABLE public.project_comparables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project comparables"
  ON public.project_comparables FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert project comparables"
  ON public.project_comparables FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update project comparables"
  ON public.project_comparables FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete project comparables"
  ON public.project_comparables FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Index for fast lookups
CREATE INDEX idx_project_comparables_project ON public.project_comparables(project_id);
