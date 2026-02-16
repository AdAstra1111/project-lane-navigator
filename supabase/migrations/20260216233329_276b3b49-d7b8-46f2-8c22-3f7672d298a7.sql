
-- Dev Engine Notes runs for Series Writer episodes
CREATE TABLE public.series_dev_notes_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  script_id UUID,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs TEXT,
  started_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_series_dev_notes_runs_project_ep ON public.series_dev_notes_runs (project_id, episode_number, created_at DESC);

-- RLS
ALTER TABLE public.series_dev_notes_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can view dev notes runs"
  ON public.series_dev_notes_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert dev notes runs"
  ON public.series_dev_notes_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update dev notes runs"
  ON public.series_dev_notes_runs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));
