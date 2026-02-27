
-- Add locked column and CHECK constraint for season_episode_count
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS season_episode_count_locked boolean NOT NULL DEFAULT false;

-- Add CHECK constraint for valid range
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_season_episode_count_range'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT chk_season_episode_count_range
      CHECK (season_episode_count IS NULL OR (season_episode_count >= 1 AND season_episode_count <= 300));
  END IF;
END $$;
