
ALTER TABLE public.development_runs
  DROP CONSTRAINT development_runs_document_id_fkey;

ALTER TABLE public.development_runs
  ADD CONSTRAINT development_runs_document_id_fkey
  FOREIGN KEY (document_id) REFERENCES public.project_documents(id) ON DELETE CASCADE;
