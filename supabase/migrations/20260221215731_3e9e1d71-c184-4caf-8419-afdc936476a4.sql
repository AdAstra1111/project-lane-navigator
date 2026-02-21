
-- Episode handoffs table: tracks roundtrip between Series Writer and Dev Engine
CREATE TABLE public.episode_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES public.series_episodes(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  from_script_id UUID REFERENCES public.scripts(id) ON DELETE SET NULL,
  dev_engine_doc_id UUID REFERENCES public.project_documents(id) ON DELETE SET NULL,
  dev_engine_version_id UUID REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  return_script_id UUID REFERENCES public.scripts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'in_progress', 'returned', 'cancelled')),
  issue_title TEXT,
  issue_description TEXT,
  desired_outcome TEXT,
  context_doc_keys TEXT[] DEFAULT '{}',
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

-- Add handoff_status to series_episodes
ALTER TABLE public.series_episodes 
  ADD COLUMN IF NOT EXISTS handoff_status TEXT DEFAULT NULL 
    CHECK (handoff_status IS NULL OR handoff_status IN ('in_dev_engine', 'returned'));

-- Indexes
CREATE INDEX idx_episode_handoffs_project ON public.episode_handoffs(project_id, status);
CREATE INDEX idx_episode_handoffs_episode ON public.episode_handoffs(episode_id, status);
CREATE INDEX idx_series_episodes_handoff ON public.series_episodes(project_id, handoff_status) WHERE handoff_status IS NOT NULL;

-- RLS
ALTER TABLE public.episode_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage handoffs for their projects" ON public.episode_handoffs
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- Updated_at trigger
CREATE TRIGGER set_episode_handoffs_updated_at
  BEFORE UPDATE ON public.episode_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
