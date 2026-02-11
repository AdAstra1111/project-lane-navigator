-- Add unique constraint for project_engine_scores upsert (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_engine_scores_project_engine_unique'
  ) THEN
    ALTER TABLE public.project_engine_scores
    ADD CONSTRAINT project_engine_scores_project_engine_unique
    UNIQUE (project_id, engine_id);
  END IF;
END $$;
