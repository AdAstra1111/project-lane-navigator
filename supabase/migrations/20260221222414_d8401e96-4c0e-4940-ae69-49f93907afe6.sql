
-- Shot Lists
CREATE TABLE public.shot_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Shot List',
  source_document_id UUID NOT NULL,
  source_version_id UUID NOT NULL,
  episode_number INT,
  scope JSONB NOT NULL DEFAULT '{"mode":"full"}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shot_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage shot lists"
  ON public.shot_lists FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_shot_lists_project ON public.shot_lists(project_id);

-- Shot List Items
CREATE TABLE public.shot_list_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_list_id UUID NOT NULL REFERENCES public.shot_lists(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  scene_number TEXT NOT NULL DEFAULT '1',
  scene_heading TEXT NOT NULL DEFAULT '',
  shot_number INT NOT NULL DEFAULT 1,
  shot_type TEXT NOT NULL DEFAULT 'WS',
  framing TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  camera_movement TEXT NOT NULL DEFAULT '',
  duration_est_seconds INT,
  location TEXT,
  time_of_day TEXT,
  characters_present JSONB,
  props_or_set_notes TEXT,
  vfx_sfx_flags JSONB,
  audio_notes TEXT,
  continuity_notes TEXT,
  locked BOOLEAN NOT NULL DEFAULT false,
  order_index INT NOT NULL DEFAULT 0,
  anchor_ref JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.shot_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage shot list items"
  ON public.shot_list_items FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_shot_list_items_list ON public.shot_list_items(shot_list_id);
CREATE INDEX idx_shot_list_items_project ON public.shot_list_items(project_id);

-- Shot List Regens
CREATE TABLE public.shot_list_regens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_list_id UUID NOT NULL REFERENCES public.shot_lists(id) ON DELETE CASCADE,
  source_version_id UUID NOT NULL,
  regen_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT
);

ALTER TABLE public.shot_list_regens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage shot list regens"
  ON public.shot_list_regens FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shot_lists sl
      WHERE sl.id = shot_list_id
      AND public.has_project_access(auth.uid(), sl.project_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shot_lists sl
      WHERE sl.id = shot_list_id
      AND public.has_project_access(auth.uid(), sl.project_id)
    )
  );

-- Updated at triggers
CREATE TRIGGER set_shot_lists_updated_at
  BEFORE UPDATE ON public.shot_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_shot_list_items_updated_at
  BEFORE UPDATE ON public.shot_list_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
