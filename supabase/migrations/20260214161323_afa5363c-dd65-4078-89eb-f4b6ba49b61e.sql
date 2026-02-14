
-- Add inherited core tracking columns to project_document_versions
ALTER TABLE project_document_versions
  ADD COLUMN IF NOT EXISTS inherited_core jsonb,
  ADD COLUMN IF NOT EXISTS source_document_ids jsonb,
  ADD COLUMN IF NOT EXISTS drift_snapshot jsonb;

-- Create drift event tracking table
CREATE TABLE IF NOT EXISTS public.document_drift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_version_id uuid NOT NULL,
  drift_level text NOT NULL DEFAULT 'none',
  drift_items jsonb DEFAULT '[]'::jsonb,
  acknowledged boolean DEFAULT false,
  resolved boolean DEFAULT false,
  resolution_type text,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

-- Validation trigger for drift_level instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_drift_level()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.drift_level IS NOT NULL AND NEW.drift_level NOT IN ('none', 'moderate', 'major') THEN
    RAISE EXCEPTION 'Invalid drift_level: %. Must be none, moderate, or major.', NEW.drift_level;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_drift_level_trigger
  BEFORE INSERT OR UPDATE ON public.document_drift_events
  FOR EACH ROW EXECUTE FUNCTION public.validate_drift_level();

-- Enable RLS
ALTER TABLE public.document_drift_events ENABLE ROW LEVEL SECURITY;

-- RLS policies: users can access drift events for projects they own or collaborate on
CREATE POLICY "Users can view drift events for their projects"
  ON public.document_drift_events
  FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create drift events for their projects"
  ON public.document_drift_events
  FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update drift events for their projects"
  ON public.document_drift_events
  FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete drift events for their projects"
  ON public.document_drift_events
  FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_drift_events_version ON public.document_drift_events(document_version_id);
CREATE INDEX IF NOT EXISTS idx_drift_events_project ON public.document_drift_events(project_id);
