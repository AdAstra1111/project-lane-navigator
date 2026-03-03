-- Add content_hash column to project_document_versions for dedupe guard
ALTER TABLE public.project_document_versions ADD COLUMN IF NOT EXISTS content_hash text;

-- Index for fast dedupe lookups: (document_id, content_hash)
CREATE INDEX IF NOT EXISTS idx_doc_versions_content_hash
ON public.project_document_versions(document_id, content_hash)
WHERE content_hash IS NOT NULL;