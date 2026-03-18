
-- Project Posters table: stores poster versions with full provenance
CREATE TABLE public.project_posters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  is_active boolean NOT NULL DEFAULT false,
  
  -- Source tracking
  source_type text NOT NULL DEFAULT 'generated', -- 'generated', 'uploaded'
  
  -- Key art (raw background image)
  key_art_storage_path text,
  key_art_public_url text,
  
  -- Rendered poster (with layout/title overlay)
  rendered_storage_path text,
  rendered_public_url text,
  
  -- Layout
  aspect_ratio text NOT NULL DEFAULT '2:3', -- poster portrait
  layout_variant text NOT NULL DEFAULT 'cinematic-dark',
  
  -- Generation provenance
  prompt_text text,
  prompt_inputs jsonb DEFAULT '{}'::jsonb,
  provider text,
  model text,
  
  -- Failure tracking
  error_message text,
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  UNIQUE(project_id, version_number)
);

-- Enable RLS
ALTER TABLE public.project_posters ENABLE ROW LEVEL SECURITY;

-- RLS policies using existing has_project_access pattern
CREATE POLICY "Users can view posters for accessible projects"
  ON public.project_posters FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert posters for accessible projects"
  ON public.project_posters FOR INSERT
  TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update posters for accessible projects"
  ON public.project_posters FOR UPDATE
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete posters for accessible projects"
  ON public.project_posters FOR DELETE
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Auto-update updated_at
CREATE TRIGGER set_project_posters_updated_at
  BEFORE UPDATE ON public.project_posters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket for poster assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-posters', 'project-posters', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: users can upload to their own project paths
CREATE POLICY "Authenticated users can upload poster assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'project-posters');

CREATE POLICY "Public can view poster assets"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'project-posters');

CREATE POLICY "Authenticated users can update poster assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'project-posters');

CREATE POLICY "Authenticated users can delete poster assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'project-posters');
