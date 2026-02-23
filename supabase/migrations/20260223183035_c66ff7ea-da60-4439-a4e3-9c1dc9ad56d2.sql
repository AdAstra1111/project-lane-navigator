
-- Add meta column to storyboard_exports
ALTER TABLE public.storyboard_exports ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
