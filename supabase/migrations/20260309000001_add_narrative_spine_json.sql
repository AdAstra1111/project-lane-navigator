-- Narrative Spine Foundation v1
-- Adds narrative_spine_json (9-axis structural lock) to projects table.
-- Populated by promote-to-devseed; propagated downstream by auto-run.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS narrative_spine_json JSONB DEFAULT NULL;

COMMENT ON COLUMN public.projects.narrative_spine_json IS
  'Locked 9-axis narrative spine: story_engine, pressure_system, central_conflict, inciting_incident, resolution_type, stakes_class, protagonist_arc, midpoint_reversal, tonal_gravity. Set once at DevSeed promotion. null = not yet set.';

CREATE INDEX IF NOT EXISTS idx_projects_narrative_spine
  ON public.projects USING GIN (narrative_spine_json)
  WHERE narrative_spine_json IS NOT NULL;
