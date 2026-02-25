
-- Nuance runs table: stores nuance profile + gate results for each story generation run
CREATE TABLE public.nuance_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  version_id UUID REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL DEFAULT '',

  -- Nuance profile scalars
  restraint INT NOT NULL DEFAULT 70,
  story_engine TEXT NOT NULL DEFAULT 'pressure_cooker',
  causal_grammar TEXT NOT NULL DEFAULT 'accumulation',
  drama_budget INT NOT NULL DEFAULT 2,
  nuance_score NUMERIC NOT NULL DEFAULT 0,
  melodrama_score NUMERIC NOT NULL DEFAULT 0,
  similarity_risk NUMERIC NOT NULL DEFAULT 0,

  -- JSONB columns
  anti_tropes JSONB NOT NULL DEFAULT '[]'::jsonb,
  constraint_pack JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  nuance_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  nuance_gate JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Attempt tracking
  attempt INT NOT NULL DEFAULT 0,
  repaired_from_run_id UUID REFERENCES public.nuance_runs(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_nuance_runs_project_created ON public.nuance_runs (project_id, created_at DESC);
CREATE INDEX idx_nuance_runs_project_engine ON public.nuance_runs (project_id, story_engine);
CREATE INDEX idx_nuance_runs_project_restraint ON public.nuance_runs (project_id, restraint);
CREATE INDEX idx_nuance_runs_anti_tropes ON public.nuance_runs USING GIN (anti_tropes);
CREATE INDEX idx_nuance_runs_fingerprint ON public.nuance_runs USING GIN (fingerprint);

-- RLS
ALTER TABLE public.nuance_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read nuance runs for their projects"
  ON public.nuance_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert nuance runs for their projects"
  ON public.nuance_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update nuance runs for their projects"
  ON public.nuance_runs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

-- Updated_at trigger
CREATE TRIGGER set_nuance_runs_updated_at
  BEFORE UPDATE ON public.nuance_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
