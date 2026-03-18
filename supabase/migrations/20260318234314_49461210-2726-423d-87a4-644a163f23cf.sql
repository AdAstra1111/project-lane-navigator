
-- Image role enum
CREATE TYPE public.project_image_role AS ENUM (
  'poster_primary',
  'poster_variant',
  'character_primary',
  'character_variant',
  'world_establishing',
  'world_detail',
  'visual_reference',
  'lookbook_cover',
  'marketing_variant'
);

-- Canonical image registry
CREATE TABLE public.project_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role project_image_role NOT NULL,
  entity_id TEXT, -- e.g. character name/index for character roles
  strategy_key TEXT, -- ties to creative framing strategy
  prompt_used TEXT NOT NULL DEFAULT '',
  negative_prompt TEXT NOT NULL DEFAULT '',
  canon_constraints JSONB NOT NULL DEFAULT '{}', -- era, geography, forbidden elements
  storage_path TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'project-posters',
  width INTEGER,
  height INTEGER,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source_poster_id UUID REFERENCES public.project_posters(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_project_images_project ON public.project_images(project_id);
CREATE INDEX idx_project_images_role ON public.project_images(project_id, role);
CREATE INDEX idx_project_images_active ON public.project_images(project_id, is_active) WHERE is_active = true;

-- RLS
ALTER TABLE public.project_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view project images they have access to"
  ON public.project_images FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert project images they own"
  ON public.project_images FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update project images they own"
  ON public.project_images FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete project images they own"
  ON public.project_images FOR DELETE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
