
-- Add idempotency columns to scene_shots
ALTER TABLE public.scene_shots ADD COLUMN IF NOT EXISTS shot_plan_job_id uuid NULL;
ALTER TABLE public.scene_shots ADD COLUMN IF NOT EXISTS shot_plan_job_scene_id uuid NULL;
ALTER TABLE public.scene_shots ADD COLUMN IF NOT EXISTS shot_plan_source text NULL;

CREATE INDEX IF NOT EXISTS idx_scene_shots_job_id ON public.scene_shots(shot_plan_job_id);
CREATE INDEX IF NOT EXISTS idx_scene_shots_scene_job ON public.scene_shots(scene_id, shot_plan_job_id);
CREATE INDEX IF NOT EXISTS idx_scene_shots_job_scene_id ON public.scene_shots(shot_plan_job_scene_id);

-- Add composite index for fast claim on job_scenes
CREATE INDEX IF NOT EXISTS idx_shot_plan_job_scenes_claim ON public.shot_plan_job_scenes(job_id, status, scene_order);
CREATE INDEX IF NOT EXISTS idx_shot_plan_job_scenes_project ON public.shot_plan_job_scenes(project_id);

-- Partial unique index for single active job per project (drop if exists first)
DROP INDEX IF EXISTS shot_plan_one_active_per_project;
DROP INDEX IF EXISTS one_active_shot_plan_job_per_project;
CREATE UNIQUE INDEX one_active_shot_plan_job_per_project
  ON public.shot_plan_jobs(project_id)
  WHERE status IN ('running','paused','queued');

-- Atomic claim RPC
CREATE OR REPLACE FUNCTION public.claim_next_shot_plan_scene(
  p_job_id uuid,
  p_stale_seconds int DEFAULT 90,
  p_max_attempts int DEFAULT 3
)
RETURNS SETOF shot_plan_job_scenes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.shot_plan_job_scenes%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.shot_plan_job_scenes
  WHERE job_id = p_job_id
    AND (
      status = 'pending'
      OR (status = 'running' AND started_at < now() - (p_stale_seconds || ' seconds')::interval AND attempts < p_max_attempts)
    )
  ORDER BY scene_order ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.shot_plan_job_scenes
  SET status = 'running',
      started_at = now(),
      attempts = COALESCE(attempts, 0) + 1,
      error_message = NULL
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
  RETURN;
END;
$$;
