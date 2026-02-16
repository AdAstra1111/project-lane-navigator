
-- Add soft-delete columns to series_episodes
ALTER TABLE public.series_episodes
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text;

-- Index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_series_episodes_not_deleted 
  ON public.series_episodes (project_id, episode_number) 
  WHERE is_deleted = false;
