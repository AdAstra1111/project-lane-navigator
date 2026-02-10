
-- Talent triage table for managing AI-suggested talent across all surfaces
CREATE TABLE public.project_talent_triage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  person_name TEXT NOT NULL,
  person_type TEXT NOT NULL DEFAULT 'cast', -- cast, director, crew, partner
  status TEXT NOT NULL DEFAULT 'unsorted', -- unsorted, shortlist, maybe, pass
  priority_rank INTEGER DEFAULT 0, -- for ordering within shortlist
  suggestion_source TEXT NOT NULL DEFAULT 'manual', -- smart-packaging, cast-explorer, manual
  suggestion_context TEXT NOT NULL DEFAULT '', -- original AI reasoning
  role_suggestion TEXT NOT NULL DEFAULT '',
  creative_fit TEXT NOT NULL DEFAULT '',
  commercial_case TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.project_talent_triage ENABLE ROW LEVEL SECURITY;

-- Policies using has_project_access for collaboration support
CREATE POLICY "Project members can view triage"
  ON public.project_talent_triage FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create triage"
  ON public.project_talent_triage FOR INSERT
  WITH CHECK ((auth.uid() = user_id) AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can update triage"
  ON public.project_talent_triage FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete triage"
  ON public.project_talent_triage FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Index for fast project lookups
CREATE INDEX idx_talent_triage_project ON public.project_talent_triage(project_id);
CREATE INDEX idx_talent_triage_status ON public.project_talent_triage(project_id, status);

-- Trigger for updated_at
CREATE TRIGGER update_talent_triage_updated_at
  BEFORE UPDATE ON public.project_talent_triage
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
