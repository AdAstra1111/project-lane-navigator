
-- AI Cast Library: actors, versions, assets, project mapping
-- ai_actors: per-user synthetic actor library
CREATE TABLE public.ai_actors (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  negative_prompt text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_actors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own actors" ON public.ai_actors FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own actors" ON public.ai_actors FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own actors" ON public.ai_actors FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own actors" ON public.ai_actors FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_ai_actors_updated_at BEFORE UPDATE ON public.ai_actors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ai_actor_versions: versioned recipes
CREATE TABLE public.ai_actor_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES public.ai_actors(id) ON DELETE CASCADE,
  version_number int NOT NULL DEFAULT 1,
  recipe_json jsonb NOT NULL DEFAULT '{}',
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
ALTER TABLE public.ai_actor_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own actor versions" ON public.ai_actor_versions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.ai_actors WHERE id = actor_id AND user_id = auth.uid())
);
CREATE POLICY "Users can create own actor versions" ON public.ai_actor_versions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.ai_actors WHERE id = actor_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own actor versions" ON public.ai_actor_versions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.ai_actors WHERE id = actor_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own actor versions" ON public.ai_actor_versions FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.ai_actors WHERE id = actor_id AND user_id = auth.uid())
);

-- ai_actor_assets: reference images, expression sets, screen tests
CREATE TABLE public.ai_actor_assets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_version_id uuid NOT NULL REFERENCES public.ai_actor_versions(id) ON DELETE CASCADE,
  asset_type text NOT NULL DEFAULT 'reference_image',
  storage_path text NOT NULL DEFAULT '',
  public_url text NOT NULL DEFAULT '',
  meta_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_actor_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own actor assets" ON public.ai_actor_assets FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.ai_actor_versions v
    JOIN public.ai_actors a ON a.id = v.actor_id
    WHERE v.id = actor_version_id AND a.user_id = auth.uid()
  )
);
CREATE POLICY "Users can create own actor assets" ON public.ai_actor_assets FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.ai_actor_versions v
    JOIN public.ai_actors a ON a.id = v.actor_id
    WHERE v.id = actor_version_id AND a.user_id = auth.uid()
  )
);
CREATE POLICY "Users can delete own actor assets" ON public.ai_actor_assets FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.ai_actor_versions v
    JOIN public.ai_actors a ON a.id = v.actor_id
    WHERE v.id = actor_version_id AND a.user_id = auth.uid()
  )
);

-- project_ai_cast: map project characters to AI actors
CREATE TABLE public.project_ai_cast (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  character_key text NOT NULL DEFAULT '',
  ai_actor_id uuid NOT NULL REFERENCES public.ai_actors(id) ON DELETE CASCADE,
  ai_actor_version_id uuid REFERENCES public.ai_actor_versions(id) ON DELETE SET NULL,
  wardrobe_pack text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, character_key)
);
ALTER TABLE public.project_ai_cast ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Project members can view ai cast" ON public.project_ai_cast FOR SELECT USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can create ai cast" ON public.project_ai_cast FOR INSERT WITH CHECK (
  public.has_project_access(auth.uid(), project_id)
  AND EXISTS (SELECT 1 FROM public.ai_actors WHERE id = ai_actor_id AND user_id = auth.uid())
);
CREATE POLICY "Project members can update ai cast" ON public.project_ai_cast FOR UPDATE USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "Project members can delete ai cast" ON public.project_ai_cast FOR DELETE USING (public.has_project_access(auth.uid(), project_id));
CREATE TRIGGER update_project_ai_cast_updated_at BEFORE UPDATE ON public.project_ai_cast FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
