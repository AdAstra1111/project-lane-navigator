
CREATE TABLE IF NOT EXISTS public.project_lane_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  lane text NOT NULL,
  prefs jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL,
  UNIQUE(project_id, lane)
);

CREATE INDEX idx_project_lane_prefs_project ON public.project_lane_prefs(project_id, lane);

ALTER TABLE public.project_lane_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their project lane prefs"
  ON public.project_lane_prefs
  FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
