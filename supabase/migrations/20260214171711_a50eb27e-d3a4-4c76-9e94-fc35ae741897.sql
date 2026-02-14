
-- Development notes tracking table
CREATE TABLE IF NOT EXISTS public.development_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  document_version_id UUID NOT NULL,
  note_key TEXT NOT NULL,
  category TEXT,
  severity TEXT CHECK (severity IN ('blocker', 'high', 'polish')),
  description TEXT,
  why_it_matters TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_in_version UUID,
  regressed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_dev_notes_project ON public.development_notes(project_id);
CREATE INDEX idx_dev_notes_doc_version ON public.development_notes(document_version_id);
CREATE INDEX idx_dev_notes_key ON public.development_notes(note_key);

-- Enable RLS
ALTER TABLE public.development_notes ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view notes for accessible projects"
ON public.development_notes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = development_notes.project_id
    AND (p.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = p.id AND pc.user_id = auth.uid() AND pc.status = 'accepted'
    ))
  )
);

CREATE POLICY "Users can insert notes for accessible projects"
ON public.development_notes FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = development_notes.project_id
    AND (p.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = p.id AND pc.user_id = auth.uid() AND pc.status = 'accepted'
    ))
  )
);

CREATE POLICY "Users can update notes for accessible projects"
ON public.development_notes FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = development_notes.project_id
    AND (p.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = p.id AND pc.user_id = auth.uid() AND pc.status = 'accepted'
    ))
  )
);

CREATE POLICY "Users can delete notes for accessible projects"
ON public.development_notes FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = development_notes.project_id
    AND (p.user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.project_collaborators pc
      WHERE pc.project_id = p.id AND pc.user_id = auth.uid() AND pc.status = 'accepted'
    ))
  )
);
