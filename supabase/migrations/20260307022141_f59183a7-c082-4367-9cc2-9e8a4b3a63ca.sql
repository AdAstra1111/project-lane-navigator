
-- review_tasks: lightweight manual review queue for validation findings
CREATE TABLE public.review_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'validation',
  source_key TEXT NOT NULL,
  doc_type TEXT,
  doc_version_id UUID,
  anchor_section TEXT,
  review_category TEXT NOT NULL DEFAULT 'ambiguity',
  severity INTEGER NOT NULL DEFAULT 3,
  summary TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  evidence_json JSONB NOT NULL DEFAULT '{}',
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_from_run_id UUID,
  last_seen_run_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint for fingerprint-based dedupe per project
CREATE UNIQUE INDEX review_tasks_project_fingerprint_unique ON public.review_tasks (project_id, fingerprint) WHERE status IN ('open', 'acknowledged');

-- Index for project lookups
CREATE INDEX review_tasks_project_id_status_idx ON public.review_tasks (project_id, status);

-- Auto-update updated_at
CREATE TRIGGER review_tasks_updated_at
  BEFORE UPDATE ON public.review_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.review_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view review tasks for their projects"
  ON public.review_tasks FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage review tasks for their projects"
  ON public.review_tasks FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
