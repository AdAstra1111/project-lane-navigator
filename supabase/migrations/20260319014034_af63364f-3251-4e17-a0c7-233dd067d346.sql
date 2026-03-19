-- Add provenance columns to project_images for story binding
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS subject_type text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS subject_ref text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS generation_purpose text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS location_ref text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS moment_ref text DEFAULT NULL;

-- Add index for efficient character lookups
CREATE INDEX IF NOT EXISTS idx_project_images_subject_lookup
  ON public.project_images (project_id, asset_group, subject, shot_type)
  WHERE curation_state IN ('active', 'candidate');

-- Add index for primary lookups
CREATE INDEX IF NOT EXISTS idx_project_images_primary
  ON public.project_images (project_id, asset_group, subject, shot_type, is_primary)
  WHERE is_primary = true;