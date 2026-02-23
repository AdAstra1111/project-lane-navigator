
-- ═══════════════════════════════════════════════════════════════
-- Trailer Audio Intelligence Engine v1 — Migration
-- Adds: trailer_audio_jobs, trailer_audio_events
-- Expands: trailer_audio_runs (new columns), trailer_audio_assets (new columns)
-- ═══════════════════════════════════════════════════════════════

-- 1) Expand trailer_audio_runs with intelligence fields
ALTER TABLE public.trailer_audio_runs
  ADD COLUMN IF NOT EXISTS inputs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS score_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS error text NULL;

-- Allow more statuses on trailer_audio_runs
-- Drop old constraint if exists, re-add
DO $$ BEGIN
  ALTER TABLE public.trailer_audio_runs DROP CONSTRAINT IF EXISTS trailer_audio_runs_status_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE public.trailer_audio_runs ADD CONSTRAINT trailer_audio_runs_status_check
  CHECK (status IN ('draft','planning','generating','mixing','ready','failed','canceled'));

-- 2) Expand trailer_audio_assets with intelligence fields
ALTER TABLE public.trailer_audio_assets
  ADD COLUMN IF NOT EXISTS audio_run_id uuid NULL REFERENCES public.trailer_audio_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS asset_type text NULL,
  ADD COLUMN IF NOT EXISTS label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider text NULL,
  ADD COLUMN IF NOT EXISTS model text NULL,
  ADD COLUMN IF NOT EXISTS meta_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_trailer_audio_assets_run_type ON public.trailer_audio_assets(audio_run_id, asset_type);

-- 3) trailer_audio_jobs (queue)
CREATE TABLE IF NOT EXISTS public.trailer_audio_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  audio_run_id uuid NOT NULL REFERENCES public.trailer_audio_runs(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('plan','gen_music','gen_vo','select_sfx','mix','mux_video','export_zip')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  attempt int NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_job_id text NULL,
  error text NULL,
  claimed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_audio_jobs_project ON public.trailer_audio_jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_jobs_run_status ON public.trailer_audio_jobs(audio_run_id, status);
CREATE INDEX IF NOT EXISTS idx_audio_jobs_status_claimed ON public.trailer_audio_jobs(status, claimed_at);

-- 4) trailer_audio_events (audit)
CREATE TABLE IF NOT EXISTS public.trailer_audio_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  audio_run_id uuid NOT NULL REFERENCES public.trailer_audio_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audio_events_project ON public.trailer_audio_events(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audio_events_run ON public.trailer_audio_events(audio_run_id, created_at DESC);

-- 5) RLS for new tables
ALTER TABLE public.trailer_audio_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_audio_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audio_jobs_access" ON public.trailer_audio_jobs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "audio_events_access" ON public.trailer_audio_events
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 6) Claim function for audio jobs
CREATE OR REPLACE FUNCTION public.claim_next_trailer_audio_job(_project_id uuid, _audio_run_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _job_id uuid;
BEGIN
  SELECT id INTO _job_id
  FROM public.trailer_audio_jobs
  WHERE project_id = _project_id
    AND audio_run_id = _audio_run_id
    AND status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _job_id IS NOT NULL THEN
    UPDATE public.trailer_audio_jobs
    SET status = 'running', attempt = attempt + 1, claimed_at = now(), updated_at = now()
    WHERE id = _job_id;
  END IF;

  RETURN _job_id;
END;
$$;
