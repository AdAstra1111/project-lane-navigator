-- Add missing columns to projects
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS season_episode_count integer,
ADD COLUMN IF NOT EXISTS current_stage text;
