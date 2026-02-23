-- Storyboard Render Queue tables + RPC

-- 1) storyboard_render_runs (batch progress tracker)
CREATE TABLE IF NOT EXISTS public.storyboard_render_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.storyboard_runs(id) ON DELETE CASCADE,
  unit_keys text[] NULL,
  status text NOT NULL DEFAULT 'running',
  total int NOT NULL DEFAULT 0,
  queued int NOT NULL DEFAULT 0,
  running int NOT NULL DEFAULT 0,
  succeeded int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  created_by uuid NOT NULL,
  last_error text NULL
);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_runs_proj_run ON public.storyboard_render_runs(project_id, run_id, started_at DESC);

-- 2) storyboard_render_jobs
CREATE TABLE IF NOT EXISTS public.storyboard_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.storyboard_runs(id) ON DELETE CASCADE,
  render_run_id uuid NOT NULL REFERENCES public.storyboard_render_runs(id) ON DELETE CASCADE,
  panel_id uuid NOT NULL REFERENCES public.storyboard_panels(id) ON DELETE CASCADE,
  unit_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority int NOT NULL DEFAULT 100,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text NULL,
  claimed_at timestamptz NULL,
  claimed_by uuid NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_proj_run ON public.storyboard_render_jobs(project_id, run_id);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_status ON public.storyboard_render_jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_panel ON public.storyboard_render_jobs(panel_id);
CREATE INDEX IF NOT EXISTS idx_storyboard_render_jobs_claimed ON public.storyboard_render_jobs(claimed_at);

-- Partial unique index: only one active (queued/running) job per panel
CREATE UNIQUE INDEX IF NOT EXISTS storyboard_render_jobs_one_active_per_panel
  ON public.storyboard_render_jobs(panel_id)
  WHERE status IN ('queued','running');

-- 3) RLS
ALTER TABLE public.storyboard_render_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storyboard_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY storyboard_render_runs_select ON public.storyboard_render_runs
  FOR SELECT USING (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id));
CREATE POLICY storyboard_render_runs_insert ON public.storyboard_render_runs
  FOR INSERT WITH CHECK (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id) AND created_by=auth.uid());
CREATE POLICY storyboard_render_runs_update ON public.storyboard_render_runs
  FOR UPDATE USING (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id))
  WITH CHECK (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id));

CREATE POLICY storyboard_render_jobs_select ON public.storyboard_render_jobs
  FOR SELECT USING (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id));
CREATE POLICY storyboard_render_jobs_insert ON public.storyboard_render_jobs
  FOR INSERT WITH CHECK (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id) AND created_by=auth.uid());
CREATE POLICY storyboard_render_jobs_update ON public.storyboard_render_jobs
  FOR UPDATE USING (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id))
  WITH CHECK (auth.role()='authenticated' AND has_project_access(auth.uid(), project_id));

-- 4) Atomic claim RPC
CREATE OR REPLACE FUNCTION public.claim_next_storyboard_render_job(
  p_project_id uuid,
  p_render_run_id uuid DEFAULT NULL,
  p_claimed_by uuid DEFAULT NULL
)
RETURNS SETOF public.storyboard_render_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.storyboard_render_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.storyboard_render_jobs
  WHERE project_id = p_project_id
    AND status = 'queued'
    AND (p_render_run_id IS NULL OR render_run_id = p_render_run_id)
  ORDER BY priority ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.storyboard_render_jobs
  SET status = 'running',
      claimed_at = now(),
      claimed_by = p_claimed_by,
      attempts = COALESCE(attempts, 0) + 1
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_next_storyboard_render_job(uuid, uuid, uuid) TO authenticated;
