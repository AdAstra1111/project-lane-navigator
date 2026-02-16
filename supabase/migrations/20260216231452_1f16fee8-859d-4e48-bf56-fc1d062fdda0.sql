
-- 1) series_continuity_runs
CREATE TABLE public.series_continuity_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  episode_version_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  results_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs TEXT,
  started_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_scr_project_episode ON public.series_continuity_runs(project_id, episode_number);
ALTER TABLE public.series_continuity_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can read continuity runs"
  ON public.series_continuity_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert continuity runs"
  ON public.series_continuity_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update continuity runs"
  ON public.series_continuity_runs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

-- 2) series_episode_canon_facts
CREATE TABLE public.series_episode_canon_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  episode_version_id UUID,
  recap TEXT,
  facts_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, episode_number)
);

ALTER TABLE public.series_episode_canon_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can read canon facts"
  ON public.series_episode_canon_facts FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert canon facts"
  ON public.series_episode_canon_facts FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update canon facts"
  ON public.series_episode_canon_facts FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

-- 3) series_continuity_issues
CREATE TABLE public.series_continuity_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.series_continuity_runs(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_number INT NOT NULL,
  severity TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  title TEXT NOT NULL,
  claim_in_episode TEXT,
  conflicts_with JSONB NOT NULL DEFAULT '[]'::jsonb,
  why_it_conflicts TEXT,
  fix_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  proposed_patch JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sci_run ON public.series_continuity_issues(run_id);
CREATE INDEX idx_sci_project_episode ON public.series_continuity_issues(project_id, episode_number);
ALTER TABLE public.series_continuity_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users with project access can read continuity issues"
  ON public.series_continuity_issues FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can insert continuity issues"
  ON public.series_continuity_issues FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can update continuity issues"
  ON public.series_continuity_issues FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users with project access can delete continuity issues"
  ON public.series_continuity_issues FOR DELETE
  USING (public.has_project_access(auth.uid(), project_id));
