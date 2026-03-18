
-- Add render_status to distinguish key-art-only from composed poster
ALTER TABLE public.project_posters 
  ADD COLUMN IF NOT EXISTS render_status text NOT NULL DEFAULT 'key_art_only';
-- Allowed values: 'key_art_only', 'composed_preview', 'composed_final'

-- Clear dishonest rendered_* values where they just copy key_art
UPDATE public.project_posters 
SET rendered_storage_path = NULL, 
    rendered_public_url = NULL,
    render_status = 'key_art_only'
WHERE rendered_storage_path = key_art_storage_path;

-- Make bucket private (drop public flag)
UPDATE storage.buckets SET public = false WHERE id = 'project-posters';

-- Drop the overly permissive public SELECT policy
DROP POLICY IF EXISTS "Public can view poster assets" ON storage.objects;

-- Replace with authenticated-only SELECT
CREATE POLICY "Authenticated users can view poster assets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'project-posters');
