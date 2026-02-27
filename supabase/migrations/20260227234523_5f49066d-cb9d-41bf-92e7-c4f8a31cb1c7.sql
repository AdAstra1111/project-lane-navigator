
-- Add doc_role column to project_documents
ALTER TABLE public.project_documents
ADD COLUMN IF NOT EXISTS doc_role text NOT NULL DEFAULT 'creative_primary';

-- Backfill system docs by doc_type patterns
UPDATE public.project_documents SET doc_role = 'system_index'
WHERE doc_type LIKE 'scene_graph__%' OR doc_type = 'universe_manifest';

UPDATE public.project_documents SET doc_role = 'system_analysis'
WHERE doc_type LIKE 'change_report__%' OR doc_type LIKE 'gate_%';

UPDATE public.project_documents SET doc_role = 'derived_output'
WHERE doc_type IN ('season_master_script');

UPDATE public.project_documents SET doc_role = 'creative_supporting'
WHERE doc_type IN ('character_bible', 'format_rules', 'canon', 'nec', 'project_overview', 'market_positioning', 'creative_brief');

-- Seed core docs stay creative_primary by default, which is correct for
-- idea, concept_brief, treatment, story_outline, beat_sheet, feature_script, episode_script, episode_grid, etc.
