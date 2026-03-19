
-- Poster credits: structured, editable billing fields per project
CREATE TABLE public.poster_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title_override TEXT, -- null = use project title
  tagline TEXT,
  written_by TEXT[] NOT NULL DEFAULT '{}',
  produced_by TEXT[] NOT NULL DEFAULT '{}',
  company_name TEXT NOT NULL DEFAULT '',
  created_by_credit TEXT, -- "Created by X" line
  based_on_credit TEXT,   -- "Based on X" line
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id)
);

CREATE INDEX idx_poster_credits_project ON public.poster_credits(project_id);

ALTER TABLE public.poster_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view poster credits they have access to"
  ON public.poster_credits FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert poster credits they own"
  ON public.poster_credits FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update poster credits they own"
  ON public.poster_credits FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete poster credits they own"
  ON public.poster_credits FOR DELETE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
