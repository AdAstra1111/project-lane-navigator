
-- Canon OS Hardening: add display_name to project_documents, add index
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS display_name text null;

-- Index for primary document lookups
CREATE INDEX IF NOT EXISTS idx_project_docs_primary ON public.project_documents (project_id, is_primary) WHERE is_primary = true;

-- Index for canon_version_id lookups
CREATE INDEX IF NOT EXISTS idx_projects_canon_version ON public.projects (canon_version_id) WHERE canon_version_id IS NOT NULL;
