
-- Casting candidates: temporary casting submissions, distinct from permanent AI Actors
CREATE TABLE public.casting_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  character_key text NOT NULL,
  batch_id text NOT NULL DEFAULT gen_random_uuid()::text,
  status text NOT NULL DEFAULT 'generated',
  display_name text,
  headshot_url text,
  full_body_url text,
  additional_refs text[] DEFAULT '{}',
  generation_config jsonb DEFAULT '{}',
  promoted_actor_id uuid REFERENCES public.ai_actors(id) ON DELETE SET NULL,
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_casting_candidates_project ON public.casting_candidates(project_id);
CREATE INDEX idx_casting_candidates_project_char ON public.casting_candidates(project_id, character_key);
CREATE INDEX idx_casting_candidates_status ON public.casting_candidates(project_id, status);

-- RLS
ALTER TABLE public.casting_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own casting candidates"
  ON public.casting_candidates
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER casting_candidates_updated_at
  BEFORE UPDATE ON public.casting_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Validate status
ALTER TABLE public.casting_candidates ADD CONSTRAINT casting_candidates_status_check
  CHECK (status IN ('generated', 'shortlisted', 'rejected', 'promoted'));
