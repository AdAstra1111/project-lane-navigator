
-- Phase 6: QC Engine tables

-- 1.1) scene_qc_runs
CREATE TABLE public.scene_qc_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  snapshot_id uuid NOT NULL REFERENCES public.scene_graph_snapshots(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'latest',
  summary text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_scene_qc_runs_project_date ON public.scene_qc_runs (project_id, created_at DESC);
CREATE INDEX idx_scene_qc_runs_project_snapshot ON public.scene_qc_runs (project_id, snapshot_id);

ALTER TABLE public.scene_qc_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view QC runs for accessible projects"
  ON public.scene_qc_runs FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert QC runs for accessible projects"
  ON public.scene_qc_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update QC runs for accessible projects"
  ON public.scene_qc_runs FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- 1.2) scene_qc_issues
CREATE TABLE public.scene_qc_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_run_id uuid NOT NULL REFERENCES public.scene_qc_runs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_scene_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  related_thread_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  linked_change_set_id uuid NULL REFERENCES public.scene_change_sets(id) ON DELETE SET NULL
);

CREATE INDEX idx_scene_qc_issues_project_run ON public.scene_qc_issues (project_id, qc_run_id);
CREATE INDEX idx_scene_qc_issues_project_severity ON public.scene_qc_issues (project_id, severity);
CREATE INDEX idx_scene_qc_issues_project_status ON public.scene_qc_issues (project_id, status);

ALTER TABLE public.scene_qc_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view QC issues for accessible projects"
  ON public.scene_qc_issues FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert QC issues for accessible projects"
  ON public.scene_qc_issues FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update QC issues for accessible projects"
  ON public.scene_qc_issues FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
