
-- Phase 1: Quality History tables for CIK

CREATE TABLE public.cinematic_quality_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_id TEXT,
  engine TEXT NOT NULL CHECK (engine IN ('trailer', 'storyboard')),
  lane TEXT,
  model TEXT NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  final_pass BOOLEAN NOT NULL DEFAULT false,
  final_score NUMERIC NOT NULL DEFAULT 0,
  settings_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE TABLE public.cinematic_quality_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.cinematic_quality_runs(id) ON DELETE CASCADE,
  attempt_index INT NOT NULL DEFAULT 0,
  score NUMERIC NOT NULL DEFAULT 0,
  pass BOOLEAN NOT NULL DEFAULT false,
  failures TEXT[] NOT NULL DEFAULT '{}',
  hard_failures TEXT[] NOT NULL DEFAULT '{}',
  diagnostic_flags TEXT[] NOT NULL DEFAULT '{}',
  unit_count INT,
  expected_unit_count INT,
  repair_instruction TEXT,
  units_json JSONB,
  metrics_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_cqr_project ON public.cinematic_quality_runs(project_id);
CREATE INDEX idx_cqr_created ON public.cinematic_quality_runs(created_at DESC);
CREATE INDEX idx_cqa_run ON public.cinematic_quality_attempts(run_id);

-- RLS
ALTER TABLE public.cinematic_quality_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cinematic_quality_attempts ENABLE ROW LEVEL SECURITY;

-- Project members can read runs
CREATE POLICY "Project members can read quality runs"
  ON public.cinematic_quality_runs FOR SELECT TO authenticated
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p WHERE p.user_id = auth.uid()
      UNION
      SELECT pc.project_id FROM public.project_collaborators pc WHERE pc.user_id = auth.uid()
    )
  );

-- Service role and project owners can insert runs
CREATE POLICY "Project members can insert quality runs"
  ON public.cinematic_quality_runs FOR INSERT TO authenticated
  WITH CHECK (
    project_id IN (
      SELECT p.id FROM public.projects p WHERE p.user_id = auth.uid()
      UNION
      SELECT pc.project_id FROM public.project_collaborators pc WHERE pc.user_id = auth.uid()
    )
  );

-- Attempts: readable if parent run is readable
CREATE POLICY "Users can read quality attempts via run"
  ON public.cinematic_quality_attempts FOR SELECT TO authenticated
  USING (
    run_id IN (
      SELECT r.id FROM public.cinematic_quality_runs r
      WHERE r.project_id IN (
        SELECT p.id FROM public.projects p WHERE p.user_id = auth.uid()
        UNION
        SELECT pc.project_id FROM public.project_collaborators pc WHERE pc.user_id = auth.uid()
      )
    )
  );

-- Attempts: insertable if parent run is accessible
CREATE POLICY "Users can insert quality attempts via run"
  ON public.cinematic_quality_attempts FOR INSERT TO authenticated
  WITH CHECK (
    run_id IN (
      SELECT r.id FROM public.cinematic_quality_runs r
      WHERE r.project_id IN (
        SELECT p.id FROM public.projects p WHERE p.user_id = auth.uid()
        UNION
        SELECT pc.project_id FROM public.project_collaborators pc WHERE pc.user_id = auth.uid()
      )
    )
  );
