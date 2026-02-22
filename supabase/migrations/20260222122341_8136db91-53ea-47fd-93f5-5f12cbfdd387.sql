
-- ═══════════════════════════════════════════════════════════════
-- REWRITE JOBS TABLE (scene-level job queue)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.rewrite_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_doc_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  target_doc_type text NOT NULL DEFAULT 'script',
  scene_id uuid NULL,
  scene_number int NOT NULL,
  scene_heading text NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  error text NULL,
  approved_notes jsonb NULL DEFAULT '[]',
  protect_items jsonb NULL DEFAULT '[]',
  claimed_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- REWRITE SCENE OUTPUTS TABLE (stores per-scene rewritten text)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.rewrite_scene_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  scene_id uuid NULL,
  scene_number int NOT NULL,
  rewritten_text text NOT NULL,
  tokens_in int NULL,
  tokens_out int NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_version_id, scene_number)
);

-- ═══════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX idx_rewrite_jobs_project_version ON public.rewrite_jobs (project_id, source_version_id);
CREATE INDEX idx_rewrite_jobs_project_status ON public.rewrite_jobs (project_id, status);
CREATE INDEX idx_rewrite_jobs_project_scene ON public.rewrite_jobs (project_id, scene_number);
CREATE INDEX idx_rewrite_scene_outputs_version ON public.rewrite_scene_outputs (source_version_id, scene_number);

-- ═══════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGER FOR REWRITE_JOBS
-- ═══════════════════════════════════════════════════════════════
CREATE TRIGGER trg_rewrite_jobs_updated_at
  BEFORE UPDATE ON public.rewrite_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.rewrite_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rewrite_scene_outputs ENABLE ROW LEVEL SECURITY;

-- rewrite_jobs: users can manage their own project's jobs
CREATE POLICY "Users can select own rewrite_jobs"
  ON public.rewrite_jobs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own rewrite_jobs"
  ON public.rewrite_jobs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND user_id = auth.uid());

CREATE POLICY "Users can update own rewrite_jobs"
  ON public.rewrite_jobs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete own rewrite_jobs"
  ON public.rewrite_jobs FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- rewrite_scene_outputs: same pattern
CREATE POLICY "Users can select own rewrite_scene_outputs"
  ON public.rewrite_scene_outputs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own rewrite_scene_outputs"
  ON public.rewrite_scene_outputs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND user_id = auth.uid());

CREATE POLICY "Users can update own rewrite_scene_outputs"
  ON public.rewrite_scene_outputs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete own rewrite_scene_outputs"
  ON public.rewrite_scene_outputs FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
