
-- Add season style template fields to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS season_style_template_doc_type text,
  ADD COLUMN IF NOT EXISTS season_style_template_version_id uuid,
  ADD COLUMN IF NOT EXISTS season_style_profile jsonb DEFAULT '{}'::jsonb;
