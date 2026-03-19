
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS reuse_pool_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_from_active_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS canon_reset_batch_id uuid DEFAULT NULL;

COMMENT ON COLUMN public.project_images.reuse_pool_eligible IS 'Whether this image is eligible for reuse in future projects/roles';
COMMENT ON COLUMN public.project_images.archived_from_active_at IS 'Timestamp when this image was detached from active canon during a reset';
COMMENT ON COLUMN public.project_images.canon_reset_batch_id IS 'Groups images that were archived together during a single canon reset operation';
