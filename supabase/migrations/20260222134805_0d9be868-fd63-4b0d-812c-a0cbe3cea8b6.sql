-- Add unique constraint for idempotent enqueue (prevents duplicate scene jobs)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rewrite_jobs_source_version_scene_unique'
  ) THEN
    ALTER TABLE public.rewrite_jobs ADD CONSTRAINT rewrite_jobs_source_version_scene_unique UNIQUE (source_version_id, scene_number);
  END IF;
END
$$;

-- Add unique constraint for scene outputs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rewrite_scene_outputs_source_version_scene_unique'
  ) THEN
    ALTER TABLE public.rewrite_scene_outputs ADD CONSTRAINT rewrite_scene_outputs_source_version_scene_unique UNIQUE (source_version_id, scene_number);
  END IF;
END
$$;