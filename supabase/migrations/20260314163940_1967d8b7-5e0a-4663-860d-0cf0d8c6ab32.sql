
-- Create execution_recommendation_runs table for change detection snapshots
CREATE TABLE public.execution_recommendation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  recommendations_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (project_id, run_id)
);

-- RLS
ALTER TABLE public.execution_recommendation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read recommendation runs for accessible projects"
  ON public.execution_recommendation_runs
  FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert recommendation runs for accessible projects"
  ON public.execution_recommendation_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Index for fast lookups
CREATE INDEX idx_exec_rec_runs_project ON public.execution_recommendation_runs(project_id, created_at DESC);
