
-- Add doc_type column to project_documents for labeling (script, treatment, deck, lookbook, document)
ALTER TABLE public.project_documents
  ADD COLUMN doc_type text NOT NULL DEFAULT 'document';

-- Add a comment for clarity
COMMENT ON COLUMN public.project_documents.doc_type IS 'Document type: script, treatment, deck, lookbook, schedule, budget, document';
