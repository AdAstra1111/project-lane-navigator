
-- Episode patch runs: stores escalation requests from Series Writer to Dev Engine
CREATE TABLE public.episode_patch_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL REFERENCES public.series_episodes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, complete, failed, applied, rejected
  issue_title TEXT NOT NULL DEFAULT '',
  issue_description TEXT NOT NULL DEFAULT '',
  desired_outcome TEXT NOT NULL DEFAULT 'other', -- continuity, character, structure, dialogue, rewrite_scenes, full_rewrite, other
  context_doc_ids TEXT[] DEFAULT '{}',
  source_notes JSONB DEFAULT '[]', -- notes/issues that triggered the escalation
  episode_script_text TEXT, -- snapshot of episode script at escalation time
  patch_summary TEXT,
  proposed_changes JSONB, -- diff-like changes or replacement script
  references_used JSONB, -- which constraints/docs were referenced
  applied_at TIMESTAMP WITH TIME ZONE,
  applied_by UUID,
  applied_version_id UUID, -- new version created on apply
  rejected_at TIMESTAMP WITH TIME ZONE,
  rejected_by UUID,
  reject_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.episode_patch_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their project patch runs"
  ON public.episode_patch_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create patch runs for their projects"
  ON public.episode_patch_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);

CREATE POLICY "Users can update patch runs for their projects"
  ON public.episode_patch_runs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete patch runs for their projects"
  ON public.episode_patch_runs FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));

-- Episode activity log for audit trail
CREATE TABLE public.episode_activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_id UUID REFERENCES public.series_episodes(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  action TEXT NOT NULL, -- soft_delete, hard_delete, restore, patch_applied, patch_rejected
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.episode_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their project activity"
  ON public.episode_activity_log FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create activity entries"
  ON public.episode_activity_log FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND auth.uid() = user_id);
