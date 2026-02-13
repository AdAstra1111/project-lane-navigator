
-- Document ingestion audit log
CREATE TABLE public.document_ingestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'pdf_text', -- 'pdf_text' | 'ocr' | 'docx' | 'plain'
  char_count INTEGER NOT NULL DEFAULT 0,
  pages_processed INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', -- 'ok' | 'needs_ocr' | 'ocr_success' | 'failed'
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_ingestions ENABLE ROW LEVEL SECURITY;

-- Users can view ingestion logs for their own projects
CREATE POLICY "Users can view own project ingestion logs"
  ON public.document_ingestions FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

-- Users can insert ingestion logs for their own projects
CREATE POLICY "Users can insert own ingestion logs"
  ON public.document_ingestions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookups
CREATE INDEX idx_document_ingestions_project ON public.document_ingestions(project_id);
CREATE INDEX idx_document_ingestions_file ON public.document_ingestions(file_path);

-- Add ingestion metadata columns to project_documents
ALTER TABLE public.project_documents
  ADD COLUMN IF NOT EXISTS ingestion_source TEXT DEFAULT 'pdf_text',
  ADD COLUMN IF NOT EXISTS char_count INTEGER DEFAULT 0;
