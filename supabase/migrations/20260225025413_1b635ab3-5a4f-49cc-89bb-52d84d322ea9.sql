
-- Demo runs orchestration table
CREATE TABLE public.demo_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id uuid NULL REFERENCES public.project_documents(id) ON DELETE SET NULL,
  lane text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  step text NOT NULL DEFAULT 'cik',
  settings_json jsonb NOT NULL DEFAULT '{}',
  links_json jsonb NOT NULL DEFAULT '{}',
  log_json jsonb NOT NULL DEFAULT '[]',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_demo_runs_project_created ON public.demo_runs (project_id, created_at DESC);

-- RLS
ALTER TABLE public.demo_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "demo_runs_select" ON public.demo_runs
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "demo_runs_insert" ON public.demo_runs
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "demo_runs_update" ON public.demo_runs
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "demo_runs_delete" ON public.demo_runs
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));
