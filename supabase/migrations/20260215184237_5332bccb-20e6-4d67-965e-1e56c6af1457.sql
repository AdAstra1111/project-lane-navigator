
-- Auto-Run Jobs table
CREATE TABLE public.auto_run_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','stopped','completed','failed')),
  mode text NOT NULL DEFAULT 'balanced' CHECK (mode IN ('fast','balanced','premium')),
  start_document text NOT NULL,
  target_document text NOT NULL DEFAULT 'draft',
  current_document text NOT NULL,
  max_stage_loops int NOT NULL DEFAULT 2,
  max_total_steps int NOT NULL DEFAULT 12,
  step_count int NOT NULL DEFAULT 0,
  stage_loop_count int NOT NULL DEFAULT 0,
  last_ci numeric,
  last_gp numeric,
  last_gap numeric,
  last_readiness int,
  last_confidence int,
  last_risk_flags jsonb DEFAULT '[]',
  stop_reason text,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.auto_run_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own auto_run_jobs" ON public.auto_run_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto_run_jobs" ON public.auto_run_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto_run_jobs" ON public.auto_run_jobs
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Service role full access auto_run_jobs" ON public.auto_run_jobs
  FOR ALL USING (true) WITH CHECK (true);

-- Auto-Run Steps table
CREATE TABLE public.auto_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.auto_run_jobs(id) ON DELETE CASCADE,
  step_index int NOT NULL,
  document text NOT NULL,
  action text NOT NULL,
  summary text,
  ci numeric,
  gp numeric,
  gap numeric,
  readiness int,
  confidence int,
  risk_flags jsonb DEFAULT '[]',
  output_text text,
  output_ref jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.auto_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own auto_run_steps" ON public.auto_run_steps
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.auto_run_jobs j WHERE j.id = job_id AND j.user_id = auth.uid())
  );

CREATE POLICY "Service role full access auto_run_steps" ON public.auto_run_steps
  FOR ALL USING (true) WITH CHECK (true);

-- Trigger for updated_at on auto_run_jobs
CREATE TRIGGER update_auto_run_jobs_updated_at
  BEFORE UPDATE ON public.auto_run_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
