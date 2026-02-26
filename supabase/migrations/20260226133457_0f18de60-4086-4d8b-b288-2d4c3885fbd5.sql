
CREATE TABLE public.style_evals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  version_id uuid NOT NULL,
  lane text NOT NULL DEFAULT 'independent-film',
  voice_source text NOT NULL DEFAULT 'none',
  team_voice_id uuid NULL,
  team_voice_label text NULL,
  writing_voice_id text NULL,
  writing_voice_label text NULL,
  score numeric NOT NULL DEFAULT 1,
  drift_level text NOT NULL DEFAULT 'low',
  fingerprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  deltas jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_style_evals_project ON public.style_evals(project_id);
CREATE INDEX idx_style_evals_version ON public.style_evals(version_id);
CREATE INDEX idx_style_evals_document ON public.style_evals(document_id);

ALTER TABLE public.style_evals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.style_evals
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Users can view style_evals for accessible projects" ON public.style_evals
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
