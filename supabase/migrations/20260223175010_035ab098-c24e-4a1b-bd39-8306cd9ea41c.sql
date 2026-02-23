
-- Storyboard Pipeline v1: all 3 tables

CREATE TABLE public.storyboard_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_visual_unit_run_id uuid NULL REFERENCES public.visual_unit_runs(id) ON DELETE SET NULL,
  unit_keys text[] NOT NULL DEFAULT '{}'::text[],
  style_preset text NOT NULL DEFAULT 'cinematic_realism',
  aspect_ratio text NOT NULL DEFAULT '16:9',
  status text NOT NULL DEFAULT 'pending',
  error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
CREATE INDEX idx_storyboard_runs_project ON public.storyboard_runs (project_id, created_at DESC);
ALTER TABLE public.storyboard_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "storyboard_runs_select" ON public.storyboard_runs FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "storyboard_runs_insert" ON public.storyboard_runs FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "storyboard_runs_update" ON public.storyboard_runs FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE TABLE public.storyboard_panels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.storyboard_runs(id) ON DELETE CASCADE,
  unit_key text NOT NULL,
  panel_index int NOT NULL,
  status text NOT NULL DEFAULT 'proposed',
  panel_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  CONSTRAINT uq_panel_run_unit_index UNIQUE (run_id, unit_key, panel_index)
);
CREATE INDEX idx_storyboard_panels_project_run ON public.storyboard_panels (project_id, run_id);
CREATE INDEX idx_storyboard_panels_project_unit ON public.storyboard_panels (project_id, unit_key);
ALTER TABLE public.storyboard_panels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "storyboard_panels_select" ON public.storyboard_panels FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "storyboard_panels_insert" ON public.storyboard_panels FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "storyboard_panels_update" ON public.storyboard_panels FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE TABLE public.storyboard_pipeline_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  panel_id uuid NOT NULL REFERENCES public.storyboard_panels(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'generated',
  storage_path text NOT NULL,
  public_url text NOT NULL,
  width int NULL,
  height int NULL,
  seed text NULL,
  model text NOT NULL DEFAULT 'google/gemini-2.5-flash-image',
  gen_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
CREATE INDEX idx_sb_pipeline_frames_panel ON public.storyboard_pipeline_frames (project_id, panel_id, created_at DESC);
ALTER TABLE public.storyboard_pipeline_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sb_pipeline_frames_select" ON public.storyboard_pipeline_frames FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sb_pipeline_frames_insert" ON public.storyboard_pipeline_frames FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id) AND created_by = auth.uid());
CREATE POLICY "sb_pipeline_frames_update" ON public.storyboard_pipeline_frames FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id)) WITH CHECK (public.has_project_access(auth.uid(), project_id));
