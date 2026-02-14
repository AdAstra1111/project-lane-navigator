
-- Series Episodes table for Vertical Drama episode management
CREATE TABLE public.series_episodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  logline TEXT DEFAULT '',
  script_id UUID REFERENCES public.scripts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  generation_progress JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, episode_number)
);

-- Enable RLS
ALTER TABLE public.series_episodes ENABLE ROW LEVEL SECURITY;

-- RLS policy mirroring scripts/projects pattern
CREATE POLICY "Series episodes project access"
  ON public.series_episodes FOR ALL
  USING (has_project_access(auth.uid(), project_id))
  WITH CHECK (has_project_access(auth.uid(), project_id));

-- Auto-update timestamp
CREATE TRIGGER update_series_episodes_updated_at
  BEFORE UPDATE ON public.series_episodes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
