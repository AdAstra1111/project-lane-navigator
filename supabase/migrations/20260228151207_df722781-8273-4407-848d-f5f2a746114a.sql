ALTER TABLE public.project_document_versions 
ADD COLUMN IF NOT EXISTS style_template_version_id uuid REFERENCES public.project_document_versions(id) DEFAULT NULL;