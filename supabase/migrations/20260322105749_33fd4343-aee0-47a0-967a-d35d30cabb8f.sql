
-- Actor Validation Runs
CREATE TABLE public.actor_validation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES public.ai_actors(id) ON DELETE CASCADE,
  actor_version_id uuid REFERENCES public.ai_actor_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'scoring', 'complete', 'failed')),
  validation_phase text NOT NULL DEFAULT 'quick' CHECK (validation_phase IN ('quick', 'full')),
  pack_coverage jsonb DEFAULT '{}',
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  triggered_by uuid
);

ALTER TABLE public.actor_validation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own validation runs"
  ON public.actor_validation_runs FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.ai_actors WHERE id = actor_validation_runs.actor_id AND user_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.ai_actors WHERE id = actor_validation_runs.actor_id AND user_id = auth.uid())
  );

-- Actor Validation Images
CREATE TABLE public.actor_validation_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_run_id uuid NOT NULL REFERENCES public.actor_validation_runs(id) ON DELETE CASCADE,
  slot_key text NOT NULL,
  variant_index int NOT NULL DEFAULT 0,
  public_url text,
  storage_path text,
  generation_config jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'complete', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.actor_validation_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own validation images"
  ON public.actor_validation_images FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.actor_validation_runs r
      JOIN public.ai_actors a ON a.id = r.actor_id
      WHERE r.id = actor_validation_images.validation_run_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.actor_validation_runs r
      JOIN public.ai_actors a ON a.id = r.actor_id
      WHERE r.id = actor_validation_images.validation_run_id AND a.user_id = auth.uid()
    )
  );

-- Actor Validation Results
CREATE TABLE public.actor_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  validation_run_id uuid NOT NULL REFERENCES public.actor_validation_runs(id) ON DELETE CASCADE UNIQUE,
  overall_score numeric,
  score_band text,
  confidence text DEFAULT 'low',
  axis_scores jsonb DEFAULT '{}',
  hard_fail_codes text[] DEFAULT '{}',
  advisory_penalty_codes text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.actor_validation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own validation results"
  ON public.actor_validation_results FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.actor_validation_runs r
      JOIN public.ai_actors a ON a.id = r.actor_id
      WHERE r.id = actor_validation_results.validation_run_id AND a.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.actor_validation_runs r
      JOIN public.ai_actors a ON a.id = r.actor_id
      WHERE r.id = actor_validation_results.validation_run_id AND a.user_id = auth.uid()
    )
  );

CREATE INDEX idx_validation_runs_actor ON public.actor_validation_runs(actor_id);
CREATE INDEX idx_validation_images_run ON public.actor_validation_images(validation_run_id);
CREATE INDEX idx_validation_results_run ON public.actor_validation_results(validation_run_id);
