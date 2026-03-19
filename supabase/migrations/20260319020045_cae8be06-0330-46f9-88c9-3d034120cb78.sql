
-- Phase 3: Add state_key and state_label for stateful visual continuity
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS state_key text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS state_label text DEFAULT NULL;

-- Index for efficient state-scoped queries
CREATE INDEX IF NOT EXISTS idx_project_images_state_key
  ON public.project_images (project_id, subject_ref, state_key)
  WHERE state_key IS NOT NULL;

COMMENT ON COLUMN public.project_images.state_key IS 'State variant key (null = base reference). E.g. baseline, formal, injured, night, damaged';
COMMENT ON COLUMN public.project_images.state_label IS 'Human-readable state label for UI display';
