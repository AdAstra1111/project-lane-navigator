
-- Store full script coverage results per draft
CREATE TABLE public.script_coverages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  draft_label TEXT NOT NULL DEFAULT 'Draft 1',
  document_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  logline TEXT NOT NULL DEFAULT '',
  synopsis TEXT NOT NULL DEFAULT '',
  themes JSONB NOT NULL DEFAULT '[]'::jsonb,
  structural_analysis TEXT NOT NULL DEFAULT '',
  character_analysis TEXT NOT NULL DEFAULT '',
  comparable_titles JSONB NOT NULL DEFAULT '[]'::jsonb,
  strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  market_positioning TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT 'CONSIDER',
  recommendation_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.script_coverages ENABLE ROW LEVEL SECURITY;

-- RLS policies using existing has_project_access function
CREATE POLICY "Project members can view coverages"
  ON public.script_coverages FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can create coverages"
  ON public.script_coverages FOR INSERT
  WITH CHECK (auth.uid() = user_id AND has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can delete coverages"
  ON public.script_coverages FOR DELETE
  USING (has_project_access(auth.uid(), project_id));

-- Index for fast lookups
CREATE INDEX idx_script_coverages_project ON public.script_coverages(project_id, created_at DESC);
