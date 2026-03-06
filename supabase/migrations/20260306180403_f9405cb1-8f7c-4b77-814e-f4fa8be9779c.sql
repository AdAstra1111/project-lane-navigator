
-- Narrative Units table for Phase 1 NUE
CREATE TABLE public.narrative_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  unit_type TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_doc_type TEXT NOT NULL,
  source_doc_version_id UUID REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  confidence NUMERIC NOT NULL DEFAULT 0.0,
  extraction_method TEXT NOT NULL DEFAULT 'deterministic',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, unit_type, unit_key)
);

-- Index for project lookups
CREATE INDEX idx_narrative_units_project ON public.narrative_units(project_id);
CREATE INDEX idx_narrative_units_type ON public.narrative_units(project_id, unit_type);

-- RLS
ALTER TABLE public.narrative_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read narrative units for accessible projects"
  ON public.narrative_units FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert narrative units for accessible projects"
  ON public.narrative_units FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update narrative units for accessible projects"
  ON public.narrative_units FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete narrative units for accessible projects"
  ON public.narrative_units FOR DELETE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Updated_at trigger
CREATE TRIGGER set_narrative_units_updated_at
  BEFORE UPDATE ON public.narrative_units
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
