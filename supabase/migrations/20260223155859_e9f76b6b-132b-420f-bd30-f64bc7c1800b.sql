
-- Enhance shot_plan_jobs with missing columns for durable operation
ALTER TABLE public.shot_plan_jobs ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'coverage';
ALTER TABLE public.shot_plan_jobs ADD COLUMN IF NOT EXISTS current_scene_index int NOT NULL DEFAULT 0;
ALTER TABLE public.shot_plan_jobs ADD COLUMN IF NOT EXISTS current_scene_id uuid NULL;
ALTER TABLE public.shot_plan_jobs ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz NULL;
ALTER TABLE public.shot_plan_jobs ADD COLUMN IF NOT EXISTS last_error text NULL;

-- Enhance shot_plan_job_scenes with missing columns
ALTER TABLE public.shot_plan_job_scenes ADD COLUMN IF NOT EXISTS scene_order int NOT NULL DEFAULT 0;
ALTER TABLE public.shot_plan_job_scenes ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- Unique partial index: only one active job per project
CREATE UNIQUE INDEX IF NOT EXISTS shot_plan_one_active_per_project
  ON public.shot_plan_jobs(project_id)
  WHERE status IN ('running', 'paused', 'queued');

-- Index for scene ordering within a job
CREATE INDEX IF NOT EXISTS shot_plan_job_scenes_job_order_idx
  ON public.shot_plan_job_scenes(job_id, scene_order);

-- Index on status for active job lookups
CREATE INDEX IF NOT EXISTS shot_plan_jobs_status_idx
  ON public.shot_plan_jobs(status);
