-- Create project_issues table
CREATE TABLE IF NOT EXISTS public.project_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_type text NOT NULL,
  doc_version_id uuid NULL,
  anchor text NULL,
  category text NOT NULL CHECK (category IN ('structural', 'continuity', 'pacing', 'dialogue', 'polish')),
  severity int NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'staged', 'resolved', 'dismissed')),
  summary text NOT NULL,
  detail text NOT NULL,
  evidence_snippet text NULL,
  fingerprint text NOT NULL,
  created_from_run_id uuid NULL,
  last_seen_run_id uuid NULL,
  resolution_mode text NOT NULL DEFAULT 'staged' CHECK (resolution_mode IN ('staged', 'manual')),
  staged_fix_choice jsonb NULL,
  verify_status text NULL CHECK (verify_status IN ('pass', 'fail', 'skipped', NULL)),
  verify_detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, fingerprint)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_issues_project_status ON public.project_issues (project_id, status);

-- Create project_issue_events audit trail table
CREATE TABLE IF NOT EXISTS public.project_issue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES public.project_issues(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('created', 'seen', 'staged', 'applied', 'resolved', 'reopened', 'dismissed', 'verified')),
  payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for events
CREATE INDEX IF NOT EXISTS idx_project_issue_events_issue_id ON public.project_issue_events (issue_id);

-- Enable RLS
ALTER TABLE public.project_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_issue_events ENABLE ROW LEVEL SECURITY;

-- RLS: project_issues — users can CRUD issues for projects they have access to
CREATE POLICY "project_issues_select" ON public.project_issues
  FOR SELECT USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_issues_insert" ON public.project_issues
  FOR INSERT WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_issues_update" ON public.project_issues
  FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "project_issues_delete" ON public.project_issues
  FOR DELETE USING (public.has_project_access(auth.uid(), project_id));

-- RLS: project_issue_events — visible if user has access to the parent issue's project
CREATE POLICY "project_issue_events_select" ON public.project_issue_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.project_issues pi
      WHERE pi.id = issue_id AND public.has_project_access(auth.uid(), pi.project_id)
    )
  );

CREATE POLICY "project_issue_events_insert" ON public.project_issue_events
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_issues pi
      WHERE pi.id = issue_id AND public.has_project_access(auth.uid(), pi.project_id)
    )
  );

-- Auto-update updated_at trigger for project_issues
CREATE OR REPLACE FUNCTION public.update_project_issues_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_project_issues_updated_at
  BEFORE UPDATE ON public.project_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_project_issues_updated_at();