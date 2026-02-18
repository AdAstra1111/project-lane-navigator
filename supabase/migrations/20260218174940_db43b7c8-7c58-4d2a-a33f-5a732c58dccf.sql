
-- Fix: allow deleting a version even if other versions reference it as parent
-- by setting parent_version_id to NULL on child versions instead of blocking
ALTER TABLE public.project_document_versions
  DROP CONSTRAINT IF EXISTS project_document_versions_parent_version_id_fkey;

ALTER TABLE public.project_document_versions
  ADD CONSTRAINT project_document_versions_parent_version_id_fkey
  FOREIGN KEY (parent_version_id)
  REFERENCES public.project_document_versions(id)
  ON DELETE SET NULL;
