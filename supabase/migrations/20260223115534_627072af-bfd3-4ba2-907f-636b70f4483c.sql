
-- ══════════════════════════════════════════════════════════
-- IFFY NOTE SYSTEM — project_notes + note_change_events
-- ══════════════════════════════════════════════════════════

-- 1) Canonical Notes Table
CREATE TABLE public.project_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source VARCHAR NOT NULL DEFAULT 'user',
  doc_type VARCHAR NULL,
  document_id UUID NULL,
  version_id UUID NULL,
  anchor JSONB NULL,
  category VARCHAR NOT NULL DEFAULT 'story',
  severity VARCHAR NOT NULL DEFAULT 'med',
  timing VARCHAR NOT NULL DEFAULT 'now',
  destination_doc_type VARCHAR NULL,
  dependent_on_note_id UUID NULL REFERENCES public.project_notes(id) ON DELETE SET NULL,
  status VARCHAR NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT NULL,
  suggested_fixes JSONB NULL,
  applied_change_event_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL
);

-- Indexes
CREATE INDEX idx_project_notes_project_status ON public.project_notes (project_id, status);
CREATE INDEX idx_project_notes_project_doc_type ON public.project_notes (project_id, doc_type);
CREATE INDEX idx_project_notes_project_timing ON public.project_notes (project_id, timing);
CREATE INDEX idx_project_notes_document_version ON public.project_notes (document_id, version_id);
CREATE INDEX idx_project_notes_anchor_gin ON public.project_notes USING gin (anchor);
CREATE INDEX idx_project_notes_later_destination ON public.project_notes (project_id, destination_doc_type) WHERE timing = 'later';

-- RLS
ALTER TABLE public.project_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view notes on accessible projects"
  ON public.project_notes FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert notes on accessible projects"
  ON public.project_notes FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update notes on accessible projects"
  ON public.project_notes FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete notes on accessible projects"
  ON public.project_notes FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- updated_at trigger
CREATE TRIGGER trg_project_notes_updated_at
  BEFORE UPDATE ON public.project_notes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Change Events Table
CREATE TABLE public.note_change_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES public.project_notes(id) ON DELETE CASCADE,
  document_id UUID NOT NULL,
  base_version_id UUID NULL,
  proposed_patch JSONB NOT NULL DEFAULT '{}',
  diff_summary TEXT NULL,
  status VARCHAR NOT NULL DEFAULT 'proposed',
  error TEXT NULL,
  result_version_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_note_change_events_note ON public.note_change_events (note_id);
CREATE INDEX idx_note_change_events_project ON public.note_change_events (project_id, status);

-- RLS
ALTER TABLE public.note_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view change events on accessible projects"
  ON public.note_change_events FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert change events on accessible projects"
  ON public.note_change_events FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update change events on accessible projects"
  ON public.note_change_events FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

-- Validation trigger: timing='later' requires destination_doc_type
CREATE OR REPLACE FUNCTION public.validate_note_timing()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.timing = 'later' AND (NEW.destination_doc_type IS NULL OR NEW.destination_doc_type = '') THEN
    RAISE EXCEPTION 'Notes with timing=later must have a destination_doc_type';
  END IF;
  IF NEW.timing = 'dependent' AND NEW.dependent_on_note_id IS NULL THEN
    -- Allow dependent without explicit note ID (could be doc-level dependency)
    NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_note_timing
  BEFORE INSERT OR UPDATE ON public.project_notes
  FOR EACH ROW EXECUTE FUNCTION public.validate_note_timing();
