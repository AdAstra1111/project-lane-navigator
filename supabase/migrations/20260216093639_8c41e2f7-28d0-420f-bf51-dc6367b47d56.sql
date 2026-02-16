
-- Vertical Episode Metrics: stores tension, retention, engagement scores per episode per canon snapshot
CREATE TABLE public.vertical_episode_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  canon_snapshot_version UUID NOT NULL REFERENCES public.canon_snapshots(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, canon_snapshot_version, episode_number)
);

ALTER TABLE public.vertical_episode_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view metrics for accessible projects"
  ON public.vertical_episode_metrics FOR SELECT
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can create metrics"
  ON public.vertical_episode_metrics FOR INSERT
  WITH CHECK (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update metrics"
  ON public.vertical_episode_metrics FOR UPDATE
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete metrics"
  ON public.vertical_episode_metrics FOR DELETE
  USING (has_project_access(auth.uid(), project_id));
