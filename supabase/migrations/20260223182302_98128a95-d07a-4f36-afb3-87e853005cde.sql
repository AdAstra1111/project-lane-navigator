
-- animatic_runs table
CREATE TABLE IF NOT EXISTS public.animatic_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storyboard_run_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  ordering jsonb NOT NULL DEFAULT '[]'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_path text,
  public_url text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_animatic_runs_proj ON public.animatic_runs(project_id, storyboard_run_id, created_at DESC);

CREATE TRIGGER set_animatic_runs_updated_at
  BEFORE UPDATE ON public.animatic_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.animatic_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "animatic_runs_select" ON public.animatic_runs
  FOR SELECT USING (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id));
CREATE POLICY "animatic_runs_insert" ON public.animatic_runs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "animatic_runs_update" ON public.animatic_runs
  FOR UPDATE USING (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid())
  WITH CHECK (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid());

-- animatic_events table
CREATE TABLE IF NOT EXISTS public.animatic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  animatic_run_id uuid NOT NULL REFERENCES public.animatic_runs(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_animatic_events_run ON public.animatic_events(animatic_run_id, created_at DESC);

ALTER TABLE public.animatic_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "animatic_events_select" ON public.animatic_events
  FOR SELECT USING (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id));
CREATE POLICY "animatic_events_insert" ON public.animatic_events
  FOR INSERT WITH CHECK (auth.role() = 'authenticated' AND has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
