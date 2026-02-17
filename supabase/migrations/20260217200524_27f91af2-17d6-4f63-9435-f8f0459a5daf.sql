
-- Add approval fields to project_document_versions
ALTER TABLE project_document_versions
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS approved_by uuid NULL;

-- Index for approval queries
CREATE INDEX IF NOT EXISTS project_document_versions_approval_idx
  ON project_document_versions(approval_status);
