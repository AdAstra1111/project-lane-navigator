
-- A) Continuity Intelligence v1 — Database Schema

-- 1) Add continuity columns to trailer_clips
ALTER TABLE public.trailer_clips
  ADD COLUMN IF NOT EXISTS continuity_tags_json jsonb NULL,
  ADD COLUMN IF NOT EXISTS continuity_version text DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS continuity_scored_at timestamptz NULL;

-- 2) trailer_continuity_runs
CREATE TABLE public.trailer_continuity_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  trailer_cut_id uuid NOT NULL,
  clip_run_id uuid NULL,
  blueprint_id uuid NULL,
  status text NOT NULL DEFAULT 'queued',
  method text NOT NULL DEFAULT 'llm_v1',
  settings_json jsonb NULL,
  summary_json jsonb NULL,
  error text NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trailer_continuity_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project continuity runs"
  ON public.trailer_continuity_runs
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 3) trailer_continuity_scores
CREATE TABLE public.trailer_continuity_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  continuity_run_id uuid NOT NULL REFERENCES public.trailer_continuity_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  trailer_cut_id uuid NOT NULL,
  from_beat_index int NOT NULL,
  to_beat_index int NOT NULL,
  from_clip_id uuid NULL,
  to_clip_id uuid NULL,
  score numeric NOT NULL DEFAULT 0,
  subscores_json jsonb NULL,
  issues_json jsonb NULL,
  suggestion_json jsonb NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_continuity_scores_project_cut ON public.trailer_continuity_scores(project_id, trailer_cut_id);
CREATE INDEX idx_continuity_scores_run ON public.trailer_continuity_scores(continuity_run_id);
CREATE INDEX idx_continuity_scores_beats ON public.trailer_continuity_scores(from_beat_index, to_beat_index);

ALTER TABLE public.trailer_continuity_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project continuity scores"
  ON public.trailer_continuity_scores
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 4) trailer_continuity_events
CREATE TABLE public.trailer_continuity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  continuity_run_id uuid NOT NULL REFERENCES public.trailer_continuity_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trailer_continuity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access own project continuity events"
  ON public.trailer_continuity_events
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
