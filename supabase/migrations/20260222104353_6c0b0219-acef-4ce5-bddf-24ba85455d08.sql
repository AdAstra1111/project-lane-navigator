
-- Phase 4: Change Sets + Diff Plumbing

-- 1.1) scene_change_sets
CREATE TABLE public.scene_change_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  title text NOT NULL,
  description text NULL,
  goal_type text NULL,
  status text NOT NULL DEFAULT 'draft',
  base_snapshot_id uuid NULL REFERENCES public.scene_graph_snapshots(id) ON DELETE SET NULL,
  applied_snapshot_id uuid NULL REFERENCES public.scene_graph_snapshots(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_scene_change_sets_project_date ON public.scene_change_sets (project_id, created_at DESC);
CREATE INDEX idx_scene_change_sets_project_status ON public.scene_change_sets (project_id, status);

ALTER TABLE public.scene_change_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage change sets for their projects"
  ON public.scene_change_sets FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.2) scene_change_set_ops
CREATE TABLE public.scene_change_set_ops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id uuid NOT NULL REFERENCES public.scene_change_sets(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  op_index int NOT NULL,
  op_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  inverse jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  error text NULL,
  UNIQUE (change_set_id, op_index)
);

CREATE INDEX idx_scene_change_set_ops_project ON public.scene_change_set_ops (project_id, change_set_id, op_index);

ALTER TABLE public.scene_change_set_ops ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage change set ops for their projects"
  ON public.scene_change_set_ops FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.3) scene_change_set_comments
CREATE TABLE public.scene_change_set_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_set_id uuid NOT NULL REFERENCES public.scene_change_sets(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  target_type text NOT NULL DEFAULT 'changeset',
  target_id uuid NULL,
  comment text NOT NULL
);

ALTER TABLE public.scene_change_set_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage change set comments for their projects"
  ON public.scene_change_set_comments FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
