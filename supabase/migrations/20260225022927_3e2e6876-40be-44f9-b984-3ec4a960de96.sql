
-- Video Generation Plans table
CREATE TABLE public.video_generation_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  document_id UUID NULL,
  quality_run_id UUID NULL REFERENCES public.cinematic_quality_runs(id) ON DELETE SET NULL,
  lane TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'cik_blueprint',
  plan_version TEXT NOT NULL DEFAULT 'v1',
  plan_json JSONB NOT NULL,
  continuity_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NULL DEFAULT auth.uid()
);

-- Indexes
CREATE INDEX idx_video_gen_plans_project_created ON public.video_generation_plans (project_id, created_at DESC);
CREATE INDEX idx_video_gen_plans_quality_run ON public.video_generation_plans (quality_run_id);
CREATE INDEX idx_video_gen_plans_lane_created ON public.video_generation_plans (lane, created_at DESC);

-- RLS
ALTER TABLE public.video_generation_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can view video_generation_plans"
  ON public.video_generation_plans FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Project members can insert video_generation_plans"
  ON public.video_generation_plans FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
