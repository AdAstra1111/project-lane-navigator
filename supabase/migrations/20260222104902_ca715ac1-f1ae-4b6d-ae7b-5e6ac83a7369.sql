
-- Phase 5: Real Diff + Review + Comments

-- 1.1) scene_diff_artifacts
CREATE TABLE public.scene_diff_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  change_set_id uuid NOT NULL REFERENCES public.scene_change_sets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  diff_type text NOT NULL,
  scene_id uuid NULL REFERENCES public.scene_graph_scenes(id) ON DELETE SET NULL,
  before_version_id uuid NULL REFERENCES public.scene_graph_versions(id) ON DELETE SET NULL,
  after_version_id uuid NULL REFERENCES public.scene_graph_versions(id) ON DELETE SET NULL,
  artifact jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_scene_diff_artifacts_cs ON public.scene_diff_artifacts (project_id, change_set_id, diff_type);
CREATE INDEX idx_scene_diff_artifacts_scene ON public.scene_diff_artifacts (change_set_id, scene_id);

ALTER TABLE public.scene_diff_artifacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage diff artifacts for their projects"
  ON public.scene_diff_artifacts FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.2) scene_diff_comments
CREATE TABLE public.scene_diff_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  change_set_id uuid NOT NULL REFERENCES public.scene_change_sets(id) ON DELETE CASCADE,
  scene_id uuid NULL REFERENCES public.scene_graph_scenes(id) ON DELETE SET NULL,
  before_version_id uuid NULL REFERENCES public.scene_graph_versions(id) ON DELETE SET NULL,
  after_version_id uuid NULL REFERENCES public.scene_graph_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  parent_id uuid NULL REFERENCES public.scene_diff_comments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  comment text NOT NULL
);

CREATE INDEX idx_scene_diff_comments_cs_scene ON public.scene_diff_comments (change_set_id, scene_id);
CREATE INDEX idx_scene_diff_comments_cs_status ON public.scene_diff_comments (change_set_id, status);
CREATE INDEX idx_scene_diff_comments_parent ON public.scene_diff_comments (parent_id);

ALTER TABLE public.scene_diff_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage diff comments for their projects"
  ON public.scene_diff_comments FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.3) scene_change_set_review_state
CREATE TABLE public.scene_change_set_review_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  change_set_id uuid NOT NULL REFERENCES public.scene_change_sets(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  before_version_id uuid NULL REFERENCES public.scene_graph_versions(id) ON DELETE SET NULL,
  after_version_id uuid NULL REFERENCES public.scene_graph_versions(id) ON DELETE SET NULL,
  decision text NOT NULL DEFAULT 'pending',
  decided_at timestamptz NULL,
  decided_by uuid NULL,
  UNIQUE (change_set_id, scene_id, before_version_id, after_version_id)
);

ALTER TABLE public.scene_change_set_review_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage review state for their projects"
  ON public.scene_change_set_review_state FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
