
-- Add legacy_key column to project_notes
ALTER TABLE public.project_notes ADD COLUMN IF NOT EXISTS legacy_key text;
CREATE INDEX IF NOT EXISTS project_notes_legacy_key ON public.project_notes(project_id, legacy_key);

-- Create project_note_events table (activity log)
CREATE TABLE IF NOT EXISTS public.project_note_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  note_id uuid NOT NULL REFERENCES public.project_notes(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

CREATE INDEX IF NOT EXISTS pnote_events_note ON public.project_note_events(note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pnote_events_project ON public.project_note_events(project_id, created_at DESC);

-- Enable RLS on project_note_events
ALTER TABLE public.project_note_events ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can read note events for accessible projects"
  ON public.project_note_events FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert note events for accessible projects"
  ON public.project_note_events FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
