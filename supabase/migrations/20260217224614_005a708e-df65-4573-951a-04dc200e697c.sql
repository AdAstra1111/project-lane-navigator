
-- Create project_deferred_notes table for storing notes deferred to later deliverables
CREATE TABLE public.project_deferred_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  source_doc_type TEXT NOT NULL DEFAULT '',
  source_version_id UUID,
  note_key TEXT NOT NULL DEFAULT '',
  note_json JSONB NOT NULL DEFAULT '{}',
  target_deliverable_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  last_checked_at TIMESTAMPTZ,
  last_seen_in_doc_type TEXT
);

-- Indexes
CREATE INDEX idx_deferred_notes_project ON public.project_deferred_notes(project_id);
CREATE INDEX idx_deferred_notes_target ON public.project_deferred_notes(project_id, target_deliverable_type, status);
CREATE UNIQUE INDEX idx_deferred_notes_unique ON public.project_deferred_notes(project_id, note_key, target_deliverable_type);

-- Enable RLS
ALTER TABLE public.project_deferred_notes ENABLE ROW LEVEL SECURITY;

-- RLS: users can manage deferred notes on projects they have access to
CREATE POLICY "Users can view deferred notes on accessible projects"
  ON public.project_deferred_notes FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert deferred notes on accessible projects"
  ON public.project_deferred_notes FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update deferred notes on accessible projects"
  ON public.project_deferred_notes FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete deferred notes on accessible projects"
  ON public.project_deferred_notes FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
