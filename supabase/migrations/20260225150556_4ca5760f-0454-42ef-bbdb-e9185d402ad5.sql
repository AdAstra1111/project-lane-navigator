
-- 1) Attempts table
CREATE TABLE IF NOT EXISTS public.trailer_clip_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  run_id uuid NULL,
  job_id uuid NULL,
  clip_id uuid NULL,
  attempt_index int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued',
  provider text NULL,
  model text NULL,
  prompt text NULL,
  prompt_hash text NOT NULL DEFAULT '',
  prompt_version text NULL,
  seed text NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NULL,
  output_public_url text NULL,
  output_storage_path text NULL,
  eval_score numeric NULL,
  eval_failures jsonb NULL,
  eval_metrics jsonb NULL,
  eval_model text NULL,
  eval_version text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_by uuid NOT NULL DEFAULT auth.uid()
);

-- 2) Indices
CREATE INDEX IF NOT EXISTS tca_by_clip ON public.trailer_clip_attempts (clip_id, attempt_index);
CREATE INDEX IF NOT EXISTS tca_by_run ON public.trailer_clip_attempts (run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tca_by_project ON public.trailer_clip_attempts (project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS tca_unique_attempt_per_clip ON public.trailer_clip_attempts (clip_id, attempt_index);

-- 3) RLS
ALTER TABLE public.trailer_clip_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tca_select" ON public.trailer_clip_attempts FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "tca_insert" ON public.trailer_clip_attempts FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "tca_update" ON public.trailer_clip_attempts FOR UPDATE USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 4) Add columns to trailer_clips
ALTER TABLE public.trailer_clips
  ADD COLUMN IF NOT EXISTS best_attempt_id uuid NULL,
  ADD COLUMN IF NOT EXISTS best_score numeric NULL,
  ADD COLUMN IF NOT EXISTS attempts_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS trailer_clips_best_attempt ON public.trailer_clips (best_attempt_id);
