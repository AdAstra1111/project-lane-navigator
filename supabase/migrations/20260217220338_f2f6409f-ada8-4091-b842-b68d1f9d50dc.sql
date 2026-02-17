
-- Add episode duration range columns to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS episode_target_duration_min_seconds integer NULL,
  ADD COLUMN IF NOT EXISTS episode_target_duration_max_seconds integer NULL;

-- Backfill: if scalar exists and min/max are null, set min=max=scalar
UPDATE public.projects
SET
  episode_target_duration_min_seconds = episode_target_duration_seconds,
  episode_target_duration_max_seconds = episode_target_duration_seconds
WHERE episode_target_duration_seconds IS NOT NULL
  AND episode_target_duration_min_seconds IS NULL
  AND episode_target_duration_max_seconds IS NULL;
