
-- Chunk storage for large-risk document generation/rewrite
CREATE TABLE public.project_document_chunks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES public.project_documents(id) ON DELETE CASCADE,
  version_id UUID REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  chunk_index INTEGER NOT NULL,
  chunk_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  char_count INTEGER,
  meta_json JSONB DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(document_id, version_id, chunk_index)
);

-- Validation trigger for status
CREATE OR REPLACE FUNCTION public.validate_chunk_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $func$
BEGIN
  IF NEW.status NOT IN ('pending', 'running', 'done', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid chunk status: %', NEW.status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_validate_chunk_status
  BEFORE INSERT OR UPDATE ON public.project_document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.validate_chunk_status();

-- Add assembled_from_chunks flag to versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS assembled_from_chunks BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS assembled_chunk_count INTEGER;

-- RLS: project access
ALTER TABLE public.project_document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view chunks for their projects" ON public.project_document_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_documents pd
      WHERE pd.id = document_id
      AND public.has_project_access(auth.uid(), pd.project_id)
    )
  );

CREATE POLICY "Users can manage chunks for their projects" ON public.project_document_chunks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.project_documents pd
      WHERE pd.id = document_id
      AND public.has_project_access(auth.uid(), pd.project_id)
    )
  );

-- Index for fast chunk lookups
CREATE INDEX idx_doc_chunks_doc_version ON public.project_document_chunks(document_id, version_id);
CREATE INDEX idx_doc_chunks_status ON public.project_document_chunks(status) WHERE status != 'done';
