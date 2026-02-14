
-- Phase 1: Dev OS Database Migrations (safe, additive only)

-- 1. Add development_behavior + episode_target_duration_seconds to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS development_behavior TEXT DEFAULT 'market',
  ADD COLUMN IF NOT EXISTS episode_target_duration_seconds INTEGER;

-- Validation trigger for development_behavior
CREATE OR REPLACE FUNCTION public.validate_development_behavior()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.development_behavior IS NOT NULL AND NEW.development_behavior NOT IN ('efficiency', 'market', 'prestige') THEN
    RAISE EXCEPTION 'Invalid development_behavior: %. Must be efficiency, market, or prestige.', NEW.development_behavior;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_development_behavior ON public.projects;
CREATE TRIGGER trg_validate_development_behavior
  BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_development_behavior();

-- 2. Add deliverable_type and stage to project_document_versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS deliverable_type TEXT,
  ADD COLUMN IF NOT EXISTS stage TEXT;

-- 3. Add contextual columns to development_runs
ALTER TABLE public.development_runs
  ADD COLUMN IF NOT EXISTS deliverable_type TEXT,
  ADD COLUMN IF NOT EXISTS development_behavior TEXT,
  ADD COLUMN IF NOT EXISTS format TEXT,
  ADD COLUMN IF NOT EXISTS episode_target_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS schema_version TEXT DEFAULT 'v2';

-- 4. Add contextual columns to coverage_runs
ALTER TABLE public.coverage_runs
  ADD COLUMN IF NOT EXISTS deliverable_type TEXT,
  ADD COLUMN IF NOT EXISTS development_behavior TEXT,
  ADD COLUMN IF NOT EXISTS format TEXT,
  ADD COLUMN IF NOT EXISTS episode_target_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS schema_version TEXT;

-- 5. Add contextual columns to improvement_runs
ALTER TABLE public.improvement_runs
  ADD COLUMN IF NOT EXISTS deliverable_type TEXT,
  ADD COLUMN IF NOT EXISTS development_behavior TEXT,
  ADD COLUMN IF NOT EXISTS format TEXT,
  ADD COLUMN IF NOT EXISTS episode_target_duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS schema_version TEXT;

-- 6. Backfill legacy document versions
UPDATE public.project_document_versions
  SET deliverable_type = 'script'
  WHERE deliverable_type IS NULL;
