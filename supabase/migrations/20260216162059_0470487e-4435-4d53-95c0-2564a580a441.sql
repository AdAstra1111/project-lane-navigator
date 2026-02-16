-- Add columns needed by the episode-patch handler
ALTER TABLE public.episode_patch_runs
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_message text;