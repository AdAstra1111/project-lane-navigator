
CREATE TABLE public.documentary_coverage_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  greenlight_score INTEGER NOT NULL DEFAULT 0,
  grant_probability INTEGER NOT NULL DEFAULT 0,
  festival_probability INTEGER NOT NULL DEFAULT 0,
  impact_score INTEGER NOT NULL DEFAULT 0,
  cultural_relevance TEXT DEFAULT '',
  access_risk TEXT DEFAULT '',
  market_fit TEXT DEFAULT '',
  risk_flags TEXT[] DEFAULT '{}',
  recommendations TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.documentary_coverage_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own coverage runs"
  ON public.documentary_coverage_runs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own coverage runs"
  ON public.documentary_coverage_runs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own coverage runs"
  ON public.documentary_coverage_runs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Collaborators can view coverage runs"
  ON public.documentary_coverage_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_doc_coverage_runs_project ON public.documentary_coverage_runs(project_id, created_at DESC);
