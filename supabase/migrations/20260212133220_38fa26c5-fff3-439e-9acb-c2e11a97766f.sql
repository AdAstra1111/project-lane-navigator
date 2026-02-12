
-- Add script engine columns to existing scripts table
ALTER TABLE public.scripts
ADD COLUMN IF NOT EXISTS owner_id uuid,
ADD COLUMN IF NOT EXISTS draft_number integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS status text DEFAULT 'BLUEPRINT',
ADD COLUMN IF NOT EXISTS structural_score numeric,
ADD COLUMN IF NOT EXISTS dialogue_score numeric,
ADD COLUMN IF NOT EXISTS economy_score numeric,
ADD COLUMN IF NOT EXISTS budget_score numeric,
ADD COLUMN IF NOT EXISTS lane_alignment_score numeric,
ADD COLUMN IF NOT EXISTS version_label text,
ADD COLUMN IF NOT EXISTS is_current boolean DEFAULT false;

-- Script Scenes table
CREATE TABLE IF NOT EXISTS public.script_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  scene_number integer NOT NULL,
  beat_summary text,
  pov_character text,
  objective text,
  obstacle text,
  conflict_type text,
  turn_summary text,
  escalation_notes text,
  location text,
  cast_size integer DEFAULT 1,
  production_weight text DEFAULT 'MEDIUM',
  scene_score numeric,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Script Versions table (stores draft snapshots)
CREATE TABLE IF NOT EXISTS public.script_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id uuid NOT NULL REFERENCES public.scripts(id) ON DELETE CASCADE,
  draft_number integer NOT NULL,
  full_text_storage_path text,
  blueprint_json jsonb,
  structural_score numeric,
  dialogue_score numeric,
  economy_score numeric,
  budget_score numeric,
  lane_alignment_score numeric,
  rewrite_pass text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.script_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.script_versions ENABLE ROW LEVEL SECURITY;

-- Script scenes policies using project access
CREATE POLICY "Users can view script scenes for their projects"
  ON public.script_scenes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_scenes.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

CREATE POLICY "Users can insert script scenes for their projects"
  ON public.script_scenes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_scenes.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

CREATE POLICY "Users can update script scenes for their projects"
  ON public.script_scenes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_scenes.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

CREATE POLICY "Users can delete script scenes for their projects"
  ON public.script_scenes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_scenes.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

-- Script versions policies
CREATE POLICY "Users can view script versions for their projects"
  ON public.script_versions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_versions.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

CREATE POLICY "Users can insert script versions for their projects"
  ON public.script_versions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_versions.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

CREATE POLICY "Users can update script versions for their projects"
  ON public.script_versions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_versions.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );

CREATE POLICY "Users can delete script versions for their projects"
  ON public.script_versions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.scripts s
      JOIN public.projects p ON p.id = s.project_id
      WHERE s.id = script_versions.script_id
      AND public.has_project_access(auth.uid(), p.id)
    )
  );
