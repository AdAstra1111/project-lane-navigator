
-- Add commit pipeline columns to existing project_decisions table
ALTER TABLE public.project_decisions
  ADD COLUMN IF NOT EXISTS field_path TEXT,
  ADD COLUMN IF NOT EXISTS new_value JSONB,
  ADD COLUMN IF NOT EXISTS confirmed_by UUID,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_to_metadata_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resulting_resolver_hash TEXT;

-- Add qualifications + locked_fields to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS qualifications JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS locked_fields JSONB DEFAULT '{}';
