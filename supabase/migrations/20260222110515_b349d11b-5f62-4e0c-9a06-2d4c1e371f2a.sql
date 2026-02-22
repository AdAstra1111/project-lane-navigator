
-- Canon OS: add canon_version_id to projects, is_primary to project_documents
-- Evolve existing project_canon_versions with status column

-- 1. Add canon_version_id to projects
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS canon_version_id UUID NULL;

-- 2. Add is_primary to project_documents
ALTER TABLE public.project_documents ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- 3. Add status column to project_canon_versions for approval workflow
ALTER TABLE public.project_canon_versions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.project_canon_versions ADD COLUMN IF NOT EXISTS version_number INT NOT NULL DEFAULT 1;
ALTER TABLE public.project_canon_versions ADD COLUMN IF NOT EXISTS summary TEXT NULL;

-- 4. Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_project_docs_primary ON public.project_documents(project_id, is_primary) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS idx_canon_versions_status ON public.project_canon_versions(project_id, status);

-- 5. Add foreign key for canon_version_id (reference project_canon_versions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projects_canon_version_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_canon_version_id_fkey
      FOREIGN KEY (canon_version_id) REFERENCES public.project_canon_versions(id) ON DELETE SET NULL;
  END IF;
END $$;
