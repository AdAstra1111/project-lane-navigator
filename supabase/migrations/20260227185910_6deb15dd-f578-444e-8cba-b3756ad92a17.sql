-- Regen Queue: persistent resumable regeneration jobs
-- TODO: Add RLS policies matching auto_run_jobs pattern once auth model stabilized

CREATE TABLE public.regen_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','error','cancelled')),
  dry_run boolean NOT NULL DEFAULT false,
  force boolean NOT NULL DEFAULT false,
  total_count int NOT NULL DEFAULT 0,
  completed_count int NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.regen_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.regen_jobs(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  document_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','regenerated','skipped','error')),
  char_before int NOT NULL DEFAULT 0,
  char_after int NOT NULL DEFAULT 0,
  upstream text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_regen_jobs_project_created ON public.regen_jobs (project_id, created_at DESC);
CREATE INDEX idx_regen_job_items_job_status ON public.regen_job_items (job_id, status);
CREATE INDEX idx_regen_job_items_job_doctype ON public.regen_job_items (job_id, doc_type);

-- Reuse existing updated_at triggers
CREATE TRIGGER set_regen_jobs_updated_at BEFORE UPDATE ON public.regen_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_regen_job_items_updated_at BEFORE UPDATE ON public.regen_job_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Disable RLS for now (service_role + internal use only)
-- TODO: Add RLS policies for owner read/write + service_role bypass
ALTER TABLE public.regen_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regen_job_items ENABLE ROW LEVEL SECURITY;

-- Permissive policies for authenticated + service_role
CREATE POLICY "regen_jobs_owner" ON public.regen_jobs
  FOR ALL USING (created_by = auth.uid()::text OR created_by = 'service_role');

CREATE POLICY "regen_job_items_via_job" ON public.regen_job_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.regen_jobs rj
      WHERE rj.id = regen_job_items.job_id
      AND (rj.created_by = auth.uid()::text OR rj.created_by = 'service_role')
    )
  );