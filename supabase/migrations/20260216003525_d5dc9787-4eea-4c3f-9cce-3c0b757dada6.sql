-- Add dependency tracking columns to project_document_versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS depends_on jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS depends_on_resolver_hash text;

-- Backfill: set depends_on for existing pitch/series docs based on their deliverable_type
UPDATE public.project_document_versions
SET depends_on = '["qualifications.season_episode_count","qualifications.episode_target_duration_seconds"]'::jsonb
WHERE deliverable_type IN ('deck', 'character_bible', 'beat_sheet')
  AND (depends_on IS NULL OR depends_on = '[]'::jsonb);