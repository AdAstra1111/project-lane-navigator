
-- Asset group enum
DO $$ BEGIN
  CREATE TYPE public.asset_group AS ENUM ('character', 'world', 'key_moment', 'visual_language', 'poster');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Shot type enum
DO $$ BEGIN
  CREATE TYPE public.shot_type AS ENUM (
    'close_up', 'medium', 'wide', 'full_body', 'profile',
    'over_shoulder', 'detail', 'tableau',
    'emotional_variant', 'atmospheric', 'time_variant',
    'lighting_ref', 'texture_ref', 'composition_ref', 'color_ref'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Curation state enum
DO $$ BEGIN
  CREATE TYPE public.curation_state AS ENUM ('active', 'candidate', 'archived', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to project_images
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS asset_group public.asset_group,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS shot_type public.shot_type,
  ADD COLUMN IF NOT EXISTS curation_state public.curation_state NOT NULL DEFAULT 'candidate';

-- Backfill asset_group from existing role values
UPDATE public.project_images SET asset_group = 'character' WHERE role IN ('character_primary', 'character_variant') AND asset_group IS NULL;
UPDATE public.project_images SET asset_group = 'world' WHERE role IN ('world_establishing', 'world_detail') AND asset_group IS NULL;
UPDATE public.project_images SET asset_group = 'poster' WHERE role IN ('poster_primary', 'poster_variant', 'lookbook_cover', 'marketing_variant') AND asset_group IS NULL;
UPDATE public.project_images SET asset_group = 'visual_language' WHERE role = 'visual_reference' AND strategy_key = 'lookbook_visual_language' AND asset_group IS NULL;
UPDATE public.project_images SET asset_group = 'key_moment' WHERE role = 'visual_reference' AND strategy_key = 'lookbook_key_moment' AND asset_group IS NULL;
UPDATE public.project_images SET asset_group = 'visual_language' WHERE role = 'visual_reference' AND asset_group IS NULL;

-- Backfill curation_state from is_primary/is_active
UPDATE public.project_images SET curation_state = 'active' WHERE is_primary = true;
UPDATE public.project_images SET curation_state = 'archived' WHERE is_active = false AND is_primary = false;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_project_images_asset_group ON public.project_images(project_id, asset_group);
CREATE INDEX IF NOT EXISTS idx_project_images_subject ON public.project_images(project_id, asset_group, subject);
CREATE INDEX IF NOT EXISTS idx_project_images_shot_type ON public.project_images(project_id, asset_group, shot_type);
CREATE INDEX IF NOT EXISTS idx_project_images_curation ON public.project_images(project_id, curation_state);
