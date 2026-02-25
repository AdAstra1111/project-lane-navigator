
CREATE TABLE public.demo_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  demo_run_id uuid REFERENCES demo_runs(id) ON DELETE SET NULL,
  bundle_id text NOT NULL UNIQUE,
  storage_path text NOT NULL,
  manifest_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.demo_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view bundles for their projects"
  ON public.demo_bundles FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert bundles for their projects"
  ON public.demo_bundles FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete bundles for their projects"
  ON public.demo_bundles FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_demo_bundles_project ON public.demo_bundles(project_id, created_at DESC);
