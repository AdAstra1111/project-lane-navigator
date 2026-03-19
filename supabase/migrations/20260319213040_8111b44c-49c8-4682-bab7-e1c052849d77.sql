
-- Add prestige style system columns to project_images
ALTER TABLE public.project_images 
  ADD COLUMN IF NOT EXISTS lane_key text,
  ADD COLUMN IF NOT EXISTS prestige_style text,
  ADD COLUMN IF NOT EXISTS lane_compliance_score smallint;

-- Add prestige style preference to projects
ALTER TABLE public.projects 
  ADD COLUMN IF NOT EXISTS default_prestige_style text;

COMMENT ON COLUMN public.project_images.lane_key IS 'Lane grammar key (e.g. vertical_drama, feature_film)';
COMMENT ON COLUMN public.project_images.prestige_style IS 'Prestige style overlay key (e.g. romantic_prestige, dark_prestige)';
COMMENT ON COLUMN public.project_images.lane_compliance_score IS 'Lane grammar compliance score 0-100';
COMMENT ON COLUMN public.projects.default_prestige_style IS 'Default prestige style for image generation';
