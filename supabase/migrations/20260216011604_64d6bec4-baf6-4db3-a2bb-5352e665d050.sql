
-- ============================
-- Stage-Progression Publishing
-- ============================

-- 1) Add missing columns to project_documents
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS latest_version_id uuid REFERENCES public.project_document_versions(id),
  ADD COLUMN IF NOT EXISTS latest_export_path text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2) Add missing columns to project_document_versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS source_run_id uuid,
  ADD COLUMN IF NOT EXISTS source_decision_ids jsonb DEFAULT '[]';

-- 3) Validation trigger for version status
CREATE OR REPLACE FUNCTION public.validate_version_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path = 'public' AS $$
BEGIN
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('draft', 'final', 'superseded') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be draft, final, or superseded.', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_version_status
  BEFORE INSERT OR UPDATE ON public.project_document_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_version_status();

-- 4) Auto-update updated_at on project_documents
CREATE TRIGGER update_project_documents_updated_at
  BEFORE UPDATE ON public.project_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Create "projects" storage bucket for package exports
INSERT INTO storage.buckets (id, name, public)
VALUES ('projects', 'projects', false)
ON CONFLICT (id) DO NOTHING;

-- 6) Storage policies for the projects bucket
CREATE POLICY "Users can read own project packages"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'projects' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload project packages"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'projects' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update project packages"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'projects' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 7) RLS policies for new columns (existing table policies cover these)
-- Existing policies on project_documents and project_document_versions already handle access.
