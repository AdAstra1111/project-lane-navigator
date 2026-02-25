
-- Create rough_cuts table
CREATE TABLE public.rough_cuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.video_render_jobs(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.video_generation_plans(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  timeline_json jsonb NOT NULL DEFAULT '{}',
  artifact_json jsonb NOT NULL DEFAULT '{}',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_rough_cuts_project_created ON public.rough_cuts (project_id, created_at DESC);
CREATE INDEX idx_rough_cuts_job ON public.rough_cuts (job_id);

-- RLS
ALTER TABLE public.rough_cuts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view rough cuts for their projects"
  ON public.rough_cuts FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert rough cuts for their projects"
  ON public.rough_cuts FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update rough cuts for their projects"
  ON public.rough_cuts FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));
