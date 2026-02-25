
-- Phase WR: writers_room_changesets table for tracking applied changes with rollback support
CREATE TABLE public.writers_room_changesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES note_threads(id) ON DELETE SET NULL,
  plan_id uuid REFERENCES note_change_plans(id) ON DELETE SET NULL,
  plan_json jsonb NOT NULL DEFAULT '{}',
  before_version_id uuid NOT NULL,
  after_version_id uuid NOT NULL,
  diff_summary jsonb NOT NULL DEFAULT '{}',
  quality_run_id uuid REFERENCES cinematic_quality_runs(id) ON DELETE SET NULL,
  rolled_back boolean NOT NULL DEFAULT false,
  rolled_back_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.writers_room_changesets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view changesets for their projects"
  ON public.writers_room_changesets FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert changesets for their projects"
  ON public.writers_room_changesets FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update changesets for their projects"
  ON public.writers_room_changesets FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_wr_changesets_project ON public.writers_room_changesets(project_id, created_at DESC);
CREATE INDEX idx_wr_changesets_document ON public.writers_room_changesets(document_id, created_at DESC);
