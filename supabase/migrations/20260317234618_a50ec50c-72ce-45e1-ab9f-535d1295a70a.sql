
-- Add blueprint family lineage fields to idea_blueprints
ALTER TABLE public.idea_blueprints
  ADD COLUMN IF NOT EXISTS blueprint_family_key text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS execution_pattern jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS family_selection_confidence numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS family_selection_rationale text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS structural_summary text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS family_candidates_considered jsonb DEFAULT NULL;

-- Add index for family_key lookups
CREATE INDEX IF NOT EXISTS idx_idea_blueprints_family_key ON public.idea_blueprints (blueprint_family_key) WHERE blueprint_family_key IS NOT NULL;

COMMENT ON COLUMN public.idea_blueprints.blueprint_family_key IS 'Selected family_key from narrative_engine_blueprint_families';
COMMENT ON COLUMN public.idea_blueprints.execution_pattern IS 'Execution pattern JSON from the selected blueprint family';
COMMENT ON COLUMN public.idea_blueprints.family_selection_confidence IS 'Deterministic selection confidence 0-1';
COMMENT ON COLUMN public.idea_blueprints.family_selection_rationale IS 'Human-readable rationale for family selection';
COMMENT ON COLUMN public.idea_blueprints.structural_summary IS 'Structural summary of the selected family for downstream consumption';
COMMENT ON COLUMN public.idea_blueprints.family_candidates_considered IS 'All candidate families evaluated during selection';
