
-- Series Writer Sessions: tracks active session, working set, resolver hash
CREATE TABLE public.series_writer_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  resolver_hash TEXT NOT NULL DEFAULT '',
  active_episode_number INT NOT NULL DEFAULT 1,
  working_set JSONB NOT NULL DEFAULT '{}',
  sequential_mode BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

ALTER TABLE public.series_writer_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions" ON public.series_writer_sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own sessions" ON public.series_writer_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.series_writer_sessions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.series_writer_sessions
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_series_writer_sessions_updated_at
  BEFORE UPDATE ON public.series_writer_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Episode Continuity Notes: generated on lock per episode
CREATE TABLE public.episode_continuity_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  user_id UUID NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(project_id, episode_number)
);

ALTER TABLE public.episode_continuity_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own continuity" ON public.episode_continuity_notes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own continuity" ON public.episode_continuity_notes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own continuity" ON public.episode_continuity_notes
  FOR UPDATE USING (auth.uid() = user_id);

-- Add locked_at + resolver_hash to series_episodes
ALTER TABLE public.series_episodes
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS resolver_hash_used TEXT,
  ADD COLUMN IF NOT EXISTS style_template_version_id UUID,
  ADD COLUMN IF NOT EXISTS is_season_template BOOLEAN NOT NULL DEFAULT false;

-- Collaborator access policies for series_writer_sessions
CREATE POLICY "Collaborators can view sessions" ON public.series_writer_sessions
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Collaborators can view continuity" ON public.episode_continuity_notes
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
