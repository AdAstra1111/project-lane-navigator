
-- Phase 4: Swap triage uniqueness from unstable recommendation_id to stable comparison_key

-- Clean any legacy rows (none expected, but defensive)
DELETE FROM public.execution_recommendation_triage WHERE comparison_key IS NULL;

-- Deduplicate any rows sharing (project_id, comparison_key) — keep latest updated_at
DELETE FROM public.execution_recommendation_triage a
USING public.execution_recommendation_triage b
WHERE a.project_id = b.project_id
  AND a.comparison_key = b.comparison_key
  AND a.updated_at < b.updated_at;

-- Drop old unique constraint on (project_id, recommendation_id)
ALTER TABLE public.execution_recommendation_triage
  DROP CONSTRAINT execution_recommendation_triag_project_id_recommendation_id_key;

-- Make comparison_key NOT NULL
ALTER TABLE public.execution_recommendation_triage
  ALTER COLUMN comparison_key SET NOT NULL;

-- Add new unique constraint on (project_id, comparison_key)
ALTER TABLE public.execution_recommendation_triage
  ADD CONSTRAINT execution_recommendation_triage_project_compkey_key
  UNIQUE (project_id, comparison_key);
