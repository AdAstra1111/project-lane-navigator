
-- Phase 4: Structural Diagnostics + Cross-Document Coherence

-- 1.1 story_metrics_runs
CREATE TABLE public.story_metrics_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  mode text NOT NULL DEFAULT 'latest',
  source_snapshot_id uuid NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  per_scene jsonb NOT NULL DEFAULT '[]'::jsonb,
  charts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'complete'
);
CREATE INDEX idx_story_metrics_runs_project ON public.story_metrics_runs (project_id, created_at DESC);
ALTER TABLE public.story_metrics_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project metrics" ON public.story_metrics_runs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.2 coherence_checks_runs
CREATE TABLE public.coherence_checks_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  mode text NOT NULL DEFAULT 'latest',
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'complete'
);
CREATE INDEX idx_coherence_checks_runs_project ON public.coherence_checks_runs (project_id, created_at DESC);
ALTER TABLE public.coherence_checks_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project coherence runs" ON public.coherence_checks_runs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.3 coherence_findings
CREATE TABLE public.coherence_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.coherence_checks_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL,
  finding_type text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL,
  related_scene_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_doc_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_repairs jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_open boolean NOT NULL DEFAULT true
);
CREATE INDEX idx_coherence_findings_project_open ON public.coherence_findings (project_id, is_open);
CREATE INDEX idx_coherence_findings_project_type ON public.coherence_findings (project_id, finding_type);
CREATE INDEX idx_coherence_findings_project_date ON public.coherence_findings (project_id, created_at DESC);
ALTER TABLE public.coherence_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project coherence findings" ON public.coherence_findings
  FOR ALL USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.4 Add columns to scene_graph_patch_queue
ALTER TABLE public.scene_graph_patch_queue
  ADD COLUMN IF NOT EXISTS source_finding_id uuid NULL REFERENCES public.coherence_findings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_run_id uuid NULL REFERENCES public.coherence_checks_runs(id) ON DELETE SET NULL;
