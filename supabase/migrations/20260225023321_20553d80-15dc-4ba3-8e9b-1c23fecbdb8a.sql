
-- Video Render Jobs table
CREATE TABLE public.video_render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.video_generation_plans(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_render_jobs_project_created ON public.video_render_jobs (project_id, created_at DESC);
CREATE INDEX idx_video_render_jobs_status_updated ON public.video_render_jobs (status, updated_at);

ALTER TABLE public.video_render_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view video_render_jobs"
  ON public.video_render_jobs FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can insert video_render_jobs"
  ON public.video_render_jobs FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update video_render_jobs"
  ON public.video_render_jobs FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Video Render Shots table
CREATE TABLE public.video_render_shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.video_render_jobs(id) ON DELETE CASCADE,
  shot_index INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INT NOT NULL DEFAULT 0,
  prompt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, shot_index)
);

CREATE INDEX idx_video_render_shots_job ON public.video_render_shots (job_id, shot_index);
CREATE INDEX idx_video_render_shots_status ON public.video_render_shots (status, updated_at);

ALTER TABLE public.video_render_shots ENABLE ROW LEVEL SECURITY;

-- RLS for shots via job's project_id
CREATE POLICY "Project members can view video_render_shots"
  ON public.video_render_shots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.video_render_jobs j
    WHERE j.id = job_id AND public.has_project_access(auth.uid(), j.project_id)
  ));

CREATE POLICY "Project members can insert video_render_shots"
  ON public.video_render_shots FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.video_render_jobs j
    WHERE j.id = job_id AND public.has_project_access(auth.uid(), j.project_id)
  ));

CREATE POLICY "Project members can update video_render_shots"
  ON public.video_render_shots FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.video_render_jobs j
    WHERE j.id = job_id AND public.has_project_access(auth.uid(), j.project_id)
  ));

-- Claim next video render job RPC (SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_next_video_render_job(p_project_id uuid)
  RETURNS SETOF video_render_jobs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.video_render_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.video_render_jobs
  WHERE project_id = p_project_id
    AND status = 'queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.video_render_jobs
  SET status = 'claimed',
      attempt_count = COALESCE(attempt_count, 0) + 1,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
  RETURN;
END;
$function$;

-- Claim next video render shot RPC (SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_next_video_render_shot(p_job_id uuid)
  RETURNS SETOF video_render_shots
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.video_render_shots%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.video_render_shots
  WHERE job_id = p_job_id
    AND status = 'queued'
  ORDER BY shot_index ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.video_render_shots
  SET status = 'claimed',
      attempt_count = COALESCE(attempt_count, 0) + 1,
      updated_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
  RETURN;
END;
$function$;
