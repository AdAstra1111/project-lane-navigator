
-- Storyboard boards
CREATE TABLE public.storyboard_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shot_list_id UUID NOT NULL REFERENCES public.shot_lists(id) ON DELETE CASCADE,
  shot_list_item_id UUID NOT NULL REFERENCES public.shot_list_items(id) ON DELETE CASCADE,
  scene_number TEXT NOT NULL DEFAULT '1',
  shot_number INT NOT NULL DEFAULT 1,
  panel_text TEXT NOT NULL DEFAULT '',
  framing_notes TEXT,
  composition_notes TEXT,
  camera_notes TEXT,
  action_notes TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '16:9',
  image_asset_path TEXT,
  image_source TEXT DEFAULT 'none',
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.storyboard_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage storyboard boards"
  ON public.storyboard_boards FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_storyboard_boards_shot_list ON public.storyboard_boards(shot_list_id);
CREATE INDEX idx_storyboard_boards_item ON public.storyboard_boards(shot_list_item_id);

-- Storyboard exports
CREATE TABLE public.storyboard_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shot_list_id UUID NOT NULL REFERENCES public.shot_lists(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL DEFAULT 'pdf',
  storage_path TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.storyboard_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Project members can manage storyboard exports"
  ON public.storyboard_exports FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Updated at trigger
CREATE TRIGGER set_storyboard_boards_updated_at
  BEFORE UPDATE ON public.storyboard_boards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
