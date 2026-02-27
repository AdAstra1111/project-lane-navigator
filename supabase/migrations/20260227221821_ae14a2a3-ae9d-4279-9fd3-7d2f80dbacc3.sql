
-- Add devseed_canon_json to pitch_ideas
ALTER TABLE public.pitch_ideas 
  ADD COLUMN IF NOT EXISTS devseed_canon_json JSONB NOT NULL DEFAULT '{}';

-- Add missing columns to projects (season_episode_count + locked already exist)
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS season_episode_count_source TEXT NULL;

ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS devseed_pitch_idea_id UUID NULL;

-- Index for devseed_pitch_idea_id lookups
CREATE INDEX IF NOT EXISTS idx_projects_devseed_pitch_idea_id 
  ON public.projects (devseed_pitch_idea_id) WHERE devseed_pitch_idea_id IS NOT NULL;
