
-- Add new columns to trailer_script_runs
ALTER TABLE public.trailer_script_runs
  ADD COLUMN IF NOT EXISTS inspiration_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reference_notes text NULL,
  ADD COLUMN IF NOT EXISTS avoid_notes text NULL,
  ADD COLUMN IF NOT EXISTS strict_canon_mode text NOT NULL DEFAULT 'strict',
  ADD COLUMN IF NOT EXISTS target_length_ms integer NULL,
  ADD COLUMN IF NOT EXISTS style_preset_key text NULL;

-- Create trailer_style_presets table
CREATE TABLE IF NOT EXISTS public.trailer_style_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  preset_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT auth.uid()
);

-- Unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_trailer_style_presets_project_name
  ON public.trailer_style_presets (project_id, name);

-- RLS
ALTER TABLE public.trailer_style_presets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage style presets for accessible projects"
  ON public.trailer_style_presets FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));
