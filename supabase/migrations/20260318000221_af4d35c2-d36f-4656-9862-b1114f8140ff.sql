-- Add blueprint lineage columns to projects table
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_blueprint_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS source_blueprint_family_key text DEFAULT NULL;

-- Add index for blueprint lineage lookups
CREATE INDEX IF NOT EXISTS idx_projects_source_blueprint_id ON public.projects (source_blueprint_id) WHERE source_blueprint_id IS NOT NULL;

COMMENT ON COLUMN public.projects.source_blueprint_id IS 'Canonical idea_blueprints.id from CI Blueprint Engine selection';
COMMENT ON COLUMN public.projects.source_blueprint_family_key IS 'Selected blueprint family_key from narrative_engine_blueprint_families';