
-- 1) Trailer Script v2
DO $$ BEGIN
  CREATE TYPE public.trailer_phase AS ENUM ('hook','setup','escalation','twist','crescendo','button');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.trailer_script_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canon_pack_id uuid NOT NULL,
  trailer_type text NOT NULL DEFAULT 'main',
  genre_key text NOT NULL DEFAULT 'unknown',
  platform_key text NOT NULL DEFAULT 'theatrical',
  seed text,
  status text NOT NULL DEFAULT 'queued',
  bpm integer,
  drop_timestamp_ms integer,
  silence_windows_json jsonb,
  escalation_curve_json jsonb,
  contrast_curve_json jsonb,
  movement_curve_json jsonb,
  structure_score numeric,
  cinematic_score numeric,
  warnings text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_trailer_script_runs_project_created
  ON public.trailer_script_runs (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trailer_script_beats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_run_id uuid NOT NULL REFERENCES public.trailer_script_runs(id) ON DELETE CASCADE,
  beat_index integer NOT NULL,
  phase public.trailer_phase NOT NULL,
  title text,
  emotional_intent text NOT NULL,
  quoted_dialogue text,
  text_card text,
  withholding_note text,
  trailer_moment_flag boolean NOT NULL DEFAULT false,
  silence_before_ms integer NOT NULL DEFAULT 0,
  silence_after_ms integer NOT NULL DEFAULT 0,
  movement_intensity_target integer NOT NULL DEFAULT 5,
  shot_density_target numeric,
  contrast_delta_score numeric,
  source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  generator_hint_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trailer_script_beats_run_index
  ON public.trailer_script_beats (script_run_id, beat_index);

-- 2) Rhythm Grid Run
CREATE TABLE IF NOT EXISTS public.trailer_rhythm_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_run_id uuid NOT NULL REFERENCES public.trailer_script_runs(id) ON DELETE CASCADE,
  seed text,
  status text NOT NULL DEFAULT 'queued',
  bpm integer NOT NULL,
  phase_timings_json jsonb NOT NULL,
  beat_grid_json jsonb NOT NULL,
  shot_duration_curve_json jsonb NOT NULL,
  density_curve_json jsonb,
  drop_timestamp_ms integer,
  silence_windows_json jsonb,
  warnings text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_trailer_rhythm_runs_script
  ON public.trailer_rhythm_runs (script_run_id, created_at DESC);

-- 3) Shot Design Run
DO $$ BEGIN
  CREATE TYPE public.camera_move AS ENUM ('static','push_in','pull_out','track','arc','handheld','whip_pan','crane','tilt','dolly_zoom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.shot_type AS ENUM ('wide','medium','close','insert','aerial','macro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.trailer_shot_design_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_run_id uuid NOT NULL REFERENCES public.trailer_script_runs(id) ON DELETE CASCADE,
  rhythm_run_id uuid REFERENCES public.trailer_rhythm_runs(id) ON DELETE SET NULL,
  seed text,
  status text NOT NULL DEFAULT 'queued',
  global_movement_curve_json jsonb,
  lens_bias_json jsonb,
  warnings text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_trailer_shot_design_runs_script
  ON public.trailer_shot_design_runs (script_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.trailer_shot_specs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_design_run_id uuid NOT NULL REFERENCES public.trailer_shot_design_runs(id) ON DELETE CASCADE,
  beat_id uuid NOT NULL REFERENCES public.trailer_script_beats(id) ON DELETE CASCADE,
  shot_index integer NOT NULL,
  shot_type public.shot_type NOT NULL,
  lens_mm integer,
  camera_move public.camera_move NOT NULL,
  movement_intensity integer NOT NULL DEFAULT 5,
  depth_strategy text,
  foreground_element text,
  lighting_note text,
  transition_in text,
  transition_out text,
  target_duration_ms integer,
  prompt_hint_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trailer_shot_specs_unique
  ON public.trailer_shot_specs (shot_design_run_id, beat_id, shot_index);

-- 4) Cinematic Judge v2
CREATE TABLE IF NOT EXISTS public.trailer_judge_v2_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_run_id uuid REFERENCES public.trailer_script_runs(id) ON DELETE CASCADE,
  rhythm_run_id uuid REFERENCES public.trailer_rhythm_runs(id) ON DELETE CASCADE,
  shot_design_run_id uuid REFERENCES public.trailer_shot_design_runs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  rubric_version text NOT NULL DEFAULT 'v2',
  scores_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags text[],
  repair_actions_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_trailer_judge_v2_runs_script
  ON public.trailer_judge_v2_runs (script_run_id, created_at DESC);

-- 5) Learning Signals
DO $$ BEGIN
  CREATE TYPE public.trailer_signal_type AS ENUM ('judge_score','user_action','external_metric');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.trailer_learning_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  script_run_id uuid REFERENCES public.trailer_script_runs(id) ON DELETE SET NULL,
  trailer_run_id uuid,
  genre_key text,
  platform_key text,
  signal_type public.trailer_signal_type NOT NULL,
  signal_key text NOT NULL,
  signal_value_num numeric,
  signal_value_json jsonb,
  weight numeric NOT NULL DEFAULT 1.0,
  source text NOT NULL DEFAULT 'system',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);

CREATE INDEX IF NOT EXISTS idx_trailer_learning_signals_project_time
  ON public.trailer_learning_signals (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_trailer_learning_signals_key
  ON public.trailer_learning_signals (signal_key, occurred_at DESC);

-- 6) RLS
ALTER TABLE public.trailer_script_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_script_beats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_rhythm_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_shot_design_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_shot_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_judge_v2_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trailer_learning_signals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_script_runs_rls ON public.trailer_script_runs
    FOR ALL USING (public.has_project_access(auth.uid(), project_id))
    WITH CHECK (public.has_project_access(auth.uid(), project_id));
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_script_beats_rls ON public.trailer_script_beats
    FOR ALL USING (
      public.has_project_access(auth.uid(),
        (SELECT project_id FROM public.trailer_script_runs r WHERE r.id = script_run_id)
      )
    )
    WITH CHECK (
      public.has_project_access(auth.uid(),
        (SELECT project_id FROM public.trailer_script_runs r WHERE r.id = script_run_id)
      )
    );
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_rhythm_runs_rls ON public.trailer_rhythm_runs
    FOR ALL USING (public.has_project_access(auth.uid(), project_id))
    WITH CHECK (public.has_project_access(auth.uid(), project_id));
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_shot_design_runs_rls ON public.trailer_shot_design_runs
    FOR ALL USING (public.has_project_access(auth.uid(), project_id))
    WITH CHECK (public.has_project_access(auth.uid(), project_id));
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_shot_specs_rls ON public.trailer_shot_specs
    FOR ALL USING (
      public.has_project_access(auth.uid(),
        (SELECT project_id FROM public.trailer_shot_design_runs r WHERE r.id = shot_design_run_id)
      )
    )
    WITH CHECK (
      public.has_project_access(auth.uid(),
        (SELECT project_id FROM public.trailer_shot_design_runs r WHERE r.id = shot_design_run_id)
      )
    );
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_judge_v2_runs_rls ON public.trailer_judge_v2_runs
    FOR ALL USING (public.has_project_access(auth.uid(), project_id))
    WITH CHECK (public.has_project_access(auth.uid(), project_id));
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  EXECUTE $pol$
    CREATE POLICY trailer_learning_signals_rls ON public.trailer_learning_signals
    FOR ALL USING (public.has_project_access(auth.uid(), project_id))
    WITH CHECK (public.has_project_access(auth.uid(), project_id));
  $pol$;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
