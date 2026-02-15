-- Add resolved qualifications columns to projects
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS resolved_qualifications jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resolved_qualifications_hash text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS resolved_qualifications_version integer DEFAULT NULL;

-- Add config entry to supabase/config.toml
COMMENT ON COLUMN public.projects.resolved_qualifications IS 'Canonical resolved qualifications from resolver';
COMMENT ON COLUMN public.projects.resolved_qualifications_hash IS 'Hash of resolved qualifications for change detection';
COMMENT ON COLUMN public.projects.resolved_qualifications_version IS 'Resolver version used';