
-- Add promotion tracking columns to projects
ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS source_pitch_idea_id uuid REFERENCES public.pitch_ideas(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS concept_lock_version integer DEFAULT 0;

-- Add promotion tracking to pitch_ideas
ALTER TABLE public.pitch_ideas
ADD COLUMN IF NOT EXISTS promoted_to_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Create concept_lock_documents table to store expansion docs as project documents on promotion
CREATE TABLE IF NOT EXISTS public.concept_lock_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  pitch_idea_id uuid NOT NULL REFERENCES public.pitch_ideas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  doc_type text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.concept_lock_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own concept lock docs"
ON public.concept_lock_documents FOR SELECT
USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert concept lock docs"
ON public.concept_lock_documents FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete concept lock docs"
ON public.concept_lock_documents FOR DELETE
USING (auth.uid() = user_id);
