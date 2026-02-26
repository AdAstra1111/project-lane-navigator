
-- Team Voices table
CREATE TABLE public.team_voices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  label text NOT NULL,
  description text,
  lane_group text,
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Team Voice Sources table
CREATE TABLE public.team_voice_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_voice_id uuid NOT NULL REFERENCES public.team_voices(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_id uuid NOT NULL,
  version_id uuid,
  title text,
  is_cowritten boolean DEFAULT false,
  cowriter_labels text[] DEFAULT '{}'::text[],
  created_at timestamptz DEFAULT now()
);

-- RLS for team_voices
ALTER TABLE public.team_voices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own team voices"
  ON public.team_voices FOR SELECT
  USING (owner_user_id = auth.uid());

CREATE POLICY "Users can insert their own team voices"
  ON public.team_voices FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Users can update their own team voices"
  ON public.team_voices FOR UPDATE
  USING (owner_user_id = auth.uid());

CREATE POLICY "Users can delete their own team voices"
  ON public.team_voices FOR DELETE
  USING (owner_user_id = auth.uid());

-- RLS for team_voice_sources
ALTER TABLE public.team_voice_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view sources of their own team voices"
  ON public.team_voice_sources FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.team_voices tv WHERE tv.id = team_voice_id AND tv.owner_user_id = auth.uid()));

CREATE POLICY "Users can insert sources for their own team voices"
  ON public.team_voice_sources FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.team_voices tv WHERE tv.id = team_voice_id AND tv.owner_user_id = auth.uid()));

CREATE POLICY "Users can delete sources of their own team voices"
  ON public.team_voice_sources FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.team_voices tv WHERE tv.id = team_voice_id AND tv.owner_user_id = auth.uid()));

-- Updated_at trigger
CREATE TRIGGER set_team_voices_updated_at
  BEFORE UPDATE ON public.team_voices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Service role policy for edge functions
CREATE POLICY "Service role full access team_voices"
  ON public.team_voices FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access team_voice_sources"
  ON public.team_voice_sources FOR ALL
  USING (auth.role() = 'service_role');
