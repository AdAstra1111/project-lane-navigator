
-- Add document storage columns to projects
ALTER TABLE public.projects
ADD COLUMN document_urls text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.projects
ADD COLUMN analysis_passes jsonb DEFAULT NULL;

-- Create storage bucket for project documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', false);

-- RLS: Users can upload documents to their own folder
CREATE POLICY "Users can upload project documents"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'project-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS: Users can view their own documents
CREATE POLICY "Users can view their own project documents"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'project-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- RLS: Users can delete their own documents
CREATE POLICY "Users can delete their own project documents"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'project-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
