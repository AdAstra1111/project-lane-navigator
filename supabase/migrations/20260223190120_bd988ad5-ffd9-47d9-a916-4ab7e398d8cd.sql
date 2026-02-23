
-- ============================================================
-- Trailer Clip Generator v1 — Job Queue + Audit
-- ============================================================

-- 1) trailer_clip_runs (batch tracking)
CREATE TABLE IF NOT EXISTS public.trailer_clip_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  blueprint_id uuid NOT NULL REFERENCES public.trailer_blueprints(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'running',
  total_jobs int NOT NULL DEFAULT 0,
  done_jobs int NOT NULL DEFAULT 0,
  failed_jobs int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tcr_project_created ON public.trailer_clip_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tcr_blueprint ON public.trailer_clip_runs(blueprint_id);

ALTER TABLE public.trailer_clip_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_clip_runs_access" ON public.trailer_clip_runs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 2) trailer_clip_jobs (queue with idempotency)
CREATE TABLE IF NOT EXISTS public.trailer_clip_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  blueprint_id uuid NOT NULL REFERENCES public.trailer_blueprints(id) ON DELETE CASCADE,
  beat_index int NOT NULL,
  clip_run_id uuid NULL REFERENCES public.trailer_clip_runs(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'veo',
  mode text NOT NULL DEFAULT 'text_to_video',
  candidate_index int NOT NULL DEFAULT 1,
  length_ms int NOT NULL DEFAULT 3000,
  aspect_ratio text NOT NULL DEFAULT '16:9',
  fps int NOT NULL DEFAULT 24,
  seed text NOT NULL DEFAULT '',
  prompt text NOT NULL DEFAULT '',
  init_image_paths text[] NOT NULL DEFAULT '{}'::text[],
  params_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempt int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  idempotency_key text NOT NULL DEFAULT '',
  provider_job_id text NULL,
  error text NULL,
  claimed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tcj_idempotency ON public.trailer_clip_jobs(idempotency_key) WHERE idempotency_key != '';
CREATE INDEX IF NOT EXISTS idx_tcj_project_created ON public.trailer_clip_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tcj_blueprint_beat ON public.trailer_clip_jobs(blueprint_id, beat_index);
CREATE INDEX IF NOT EXISTS idx_tcj_status_claimed ON public.trailer_clip_jobs(status, claimed_at);

ALTER TABLE public.trailer_clip_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_clip_jobs_access" ON public.trailer_clip_jobs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 3) Add columns to existing trailer_clips table
ALTER TABLE public.trailer_clips
  ADD COLUMN IF NOT EXISTS job_id uuid NULL REFERENCES public.trailer_clip_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS clip_run_id uuid NULL REFERENCES public.trailer_clip_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS candidate_index int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS seed text NULL,
  ADD COLUMN IF NOT EXISTS model text NULL,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'text_to_video',
  ADD COLUMN IF NOT EXISTS aspect_ratio text NOT NULL DEFAULT '16:9',
  ADD COLUMN IF NOT EXISTS fps int NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS thumb_path text NULL,
  ADD COLUMN IF NOT EXISTS score_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;

-- 4) trailer_clip_events (audit trail)
CREATE TABLE IF NOT EXISTS public.trailer_clip_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  blueprint_id uuid NOT NULL,
  beat_index int NULL,
  job_id uuid NULL,
  clip_id uuid NULL,
  clip_run_id uuid NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tce_project_created ON public.trailer_clip_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tce_blueprint_created ON public.trailer_clip_events(blueprint_id, created_at DESC);

ALTER TABLE public.trailer_clip_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trailer_clip_events_access" ON public.trailer_clip_events
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 5) updated_at triggers (reuse existing set_updated_at function)
CREATE TRIGGER set_trailer_clip_runs_updated_at
  BEFORE UPDATE ON public.trailer_clip_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_trailer_clip_jobs_updated_at
  BEFORE UPDATE ON public.trailer_clip_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6) Claim next job RPC (atomic with SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_next_trailer_clip_job(
  _project_id uuid,
  _blueprint_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _job_id uuid;
BEGIN
  SELECT id INTO _job_id
  FROM public.trailer_clip_jobs
  WHERE project_id = _project_id
    AND blueprint_id = _blueprint_id
    AND status = 'queued'
  ORDER BY beat_index, candidate_index
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _job_id IS NOT NULL THEN
    UPDATE public.trailer_clip_jobs
    SET status = 'running', attempt = attempt + 1, claimed_at = now(), updated_at = now()
    WHERE id = _job_id;
  END IF;

  RETURN _job_id;
END;
$$;

-- 7) Storage bucket for trailers
INSERT INTO storage.buckets (id, name, public)
VALUES ('trailers', 'trailers', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: allow authenticated users with project access to upload/read
CREATE POLICY "trailers_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'trailers');

CREATE POLICY "trailers_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'trailers'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "trailers_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'trailers'
    AND auth.role() = 'authenticated'
  );
