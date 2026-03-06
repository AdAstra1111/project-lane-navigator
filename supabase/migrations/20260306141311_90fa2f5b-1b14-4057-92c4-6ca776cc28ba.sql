
-- Unified lifecycle event store for all 3 issue source systems
CREATE TABLE public.project_issue_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_row_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_pile_project_source ON public.project_issue_lifecycle_events (project_id, source_table);
CREATE INDEX idx_pile_source_row ON public.project_issue_lifecycle_events (source_table, source_row_id);
CREATE INDEX idx_pile_project_created ON public.project_issue_lifecycle_events (project_id, created_at DESC);

-- RLS
ALTER TABLE public.project_issue_lifecycle_events ENABLE ROW LEVEL SECURITY;

-- SELECT: project access
CREATE POLICY "Users can view lifecycle events for accessible projects"
  ON public.project_issue_lifecycle_events
  FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- INSERT: project access (edge functions use service role, but authenticated users with access can also write)
CREATE POLICY "Users can insert lifecycle events for accessible projects"
  ON public.project_issue_lifecycle_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
