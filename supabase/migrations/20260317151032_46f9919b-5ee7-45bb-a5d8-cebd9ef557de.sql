
-- Plateau Diagnosis table for DevSeed Optimizer MVP
CREATE TABLE public.devseed_plateau_diagnoses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  auto_run_job_id UUID REFERENCES public.auto_run_jobs(id) ON DELETE SET NULL,
  pitch_idea_id UUID NULL,
  source_dna_profile_id UUID NULL,
  source_blueprint_id UUID NULL,
  source_blueprint_run_id UUID NULL,
  generation_mode TEXT NULL,
  optimizer_mode TEXT NULL,
  final_ci NUMERIC NULL,
  final_gp NUMERIC NULL,
  target_ci NUMERIC NOT NULL DEFAULT 95,
  target_gp NUMERIC NOT NULL DEFAULT 95,
  best_ci_seen NUMERIC NULL,
  halted_doc_type TEXT NULL,
  halted_reason TEXT NULL,
  diagnosis_version TEXT NOT NULL DEFAULT 'v1',
  primary_cause TEXT NOT NULL DEFAULT 'unknown',
  secondary_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
  rewriteable BOOLEAN NOT NULL DEFAULT false,
  seed_limited BOOLEAN NOT NULL DEFAULT false,
  confidence TEXT NOT NULL DEFAULT 'low',
  evidence_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendation_bundle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_devseed_plateau_diag_project ON public.devseed_plateau_diagnoses(project_id);
CREATE INDEX idx_devseed_plateau_diag_job ON public.devseed_plateau_diagnoses(auto_run_job_id);
CREATE INDEX idx_devseed_plateau_diag_user ON public.devseed_plateau_diagnoses(user_id);

-- RLS
ALTER TABLE public.devseed_plateau_diagnoses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plateau diagnoses"
  ON public.devseed_plateau_diagnoses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plateau diagnoses"
  ON public.devseed_plateau_diagnoses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access plateau diagnoses"
  ON public.devseed_plateau_diagnoses FOR ALL
  USING (auth.role() = 'service_role');
