
-- Phase 7: Pass Runner tables

CREATE TABLE public.scene_pass_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  snapshot_id uuid NOT NULL REFERENCES public.scene_graph_snapshots(id) ON DELETE CASCADE,
  pass_type text NOT NULL,
  mode text NOT NULL DEFAULT 'approved_prefer',
  status text NOT NULL DEFAULT 'completed',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NULL,
  created_change_set_id uuid NULL REFERENCES public.scene_change_sets(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_scene_pass_runs_project_date ON public.scene_pass_runs (project_id, created_at DESC);
CREATE INDEX idx_scene_pass_runs_project_type ON public.scene_pass_runs (project_id, pass_type);

ALTER TABLE public.scene_pass_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view pass runs for accessible projects"
  ON public.scene_pass_runs FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert pass runs for accessible projects"
  ON public.scene_pass_runs FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update pass runs for accessible projects"
  ON public.scene_pass_runs FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
