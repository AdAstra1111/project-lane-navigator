
-- =====================================================
-- Audio Engine v1.1 + MP4 Mux Pipeline
-- =====================================================

-- 1) trailer_audio_assets — reusable audio files
CREATE TABLE public.trailer_audio_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('music_bed', 'sfx')),
  name text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}'::text[],
  storage_path text NOT NULL,
  duration_ms int NULL,
  bpm int NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trailer_audio_assets_project_kind ON public.trailer_audio_assets (project_id, kind);
CREATE INDEX idx_trailer_audio_assets_project_created ON public.trailer_audio_assets (project_id, created_at DESC);

ALTER TABLE public.trailer_audio_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trailer_audio_assets_access" ON public.trailer_audio_assets
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 2) trailer_audio_runs — audio plan + mix settings per trailer cut
CREATE TABLE public.trailer_audio_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  trailer_cut_id uuid NOT NULL REFERENCES public.trailer_cuts(id) ON DELETE CASCADE,
  blueprint_id uuid NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'mixing', 'ready', 'failed')),
  music_bed_asset_id uuid NULL REFERENCES public.trailer_audio_assets(id),
  sfx_pack_tag text NULL,
  plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  mix_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_wav_path text NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trailer_audio_runs_project ON public.trailer_audio_runs (project_id, created_at DESC);
CREATE INDEX idx_trailer_audio_runs_cut ON public.trailer_audio_runs (trailer_cut_id);

ALTER TABLE public.trailer_audio_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trailer_audio_runs_access" ON public.trailer_audio_runs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER trg_trailer_audio_runs_updated_at
  BEFORE UPDATE ON public.trailer_audio_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) trailer_render_jobs — server render queue for MP4 mux
CREATE TABLE public.trailer_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  trailer_cut_id uuid NOT NULL REFERENCES public.trailer_cuts(id) ON DELETE CASCADE,
  audio_run_id uuid NULL REFERENCES public.trailer_audio_runs(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  attempt int NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_mp4_path text NULL,
  output_audio_path text NULL,
  preset text NOT NULL DEFAULT '720p',
  error text NULL,
  claimed_at timestamptz NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trailer_render_jobs_project ON public.trailer_render_jobs (project_id, created_at DESC);
CREATE INDEX idx_trailer_render_jobs_cut ON public.trailer_render_jobs (trailer_cut_id);
CREATE INDEX idx_trailer_render_jobs_status ON public.trailer_render_jobs (status, claimed_at);
CREATE UNIQUE INDEX idx_trailer_render_jobs_idempotency ON public.trailer_render_jobs (idempotency_key);

ALTER TABLE public.trailer_render_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trailer_render_jobs_access" ON public.trailer_render_jobs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE TRIGGER trg_trailer_render_jobs_updated_at
  BEFORE UPDATE ON public.trailer_render_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) trailer_render_events — audit log
CREATE TABLE public.trailer_render_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  render_job_id uuid NOT NULL REFERENCES public.trailer_render_jobs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_trailer_render_events_project ON public.trailer_render_events (project_id, created_at DESC);
CREATE INDEX idx_trailer_render_events_job ON public.trailer_render_events (render_job_id, created_at DESC);

ALTER TABLE public.trailer_render_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trailer_render_events_access" ON public.trailer_render_events
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 5) Add mp4/wav output columns to trailer_cuts
ALTER TABLE public.trailer_cuts ADD COLUMN IF NOT EXISTS output_mp4_path text NULL;
ALTER TABLE public.trailer_cuts ADD COLUMN IF NOT EXISTS output_wav_path text NULL;

-- 6) Claim RPC for render jobs
CREATE OR REPLACE FUNCTION public.claim_next_trailer_render_job(_project_id uuid, _trailer_cut_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _job_id uuid;
BEGIN
  SELECT id INTO _job_id
  FROM public.trailer_render_jobs
  WHERE project_id = _project_id
    AND trailer_cut_id = _trailer_cut_id
    AND status = 'queued'
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF _job_id IS NOT NULL THEN
    UPDATE public.trailer_render_jobs
    SET status = 'running', attempt = attempt + 1, claimed_at = now(), updated_at = now()
    WHERE id = _job_id;
  END IF;

  RETURN _job_id;
END;
$$;
