
-- ================================================================
-- Phase 5: Visual Production Engine tables
-- ================================================================

-- 1.1) scene_shot_sets
CREATE TABLE public.scene_shot_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  scene_version_id uuid NOT NULL REFERENCES public.scene_graph_versions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  mode text NOT NULL DEFAULT 'coverage',
  aspect_ratio text NOT NULL DEFAULT '2.39:1',
  status text NOT NULL DEFAULT 'draft',
  notes text NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (project_id, scene_version_id, mode)
);
CREATE INDEX idx_scene_shot_sets_project ON public.scene_shot_sets(project_id);
CREATE INDEX idx_scene_shot_sets_scene ON public.scene_shot_sets(project_id, scene_id);

ALTER TABLE public.scene_shot_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project shot sets" ON public.scene_shot_sets
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- 1.2) scene_shots
CREATE TABLE public.scene_shots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shot_set_id uuid NOT NULL REFERENCES public.scene_shot_sets(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  scene_version_id uuid NOT NULL REFERENCES public.scene_graph_versions(id) ON DELETE CASCADE,
  order_key text NOT NULL,
  shot_number int NULL,
  shot_type text NOT NULL DEFAULT 'shot',
  coverage_role text NULL,
  framing text NULL,
  lens_mm int NULL,
  camera_support text NULL,
  camera_movement text NULL,
  angle text NULL,
  composition_notes text NULL,
  blocking_notes text NULL,
  emotional_intent text NULL,
  narrative_function text NULL,
  characters_in_frame jsonb NOT NULL DEFAULT '[]'::jsonb,
  props_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  sfx_vfx_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  est_duration_seconds int NULL,
  est_setup_complexity int NULL,
  lighting_style text NULL,
  location_hint text NULL,
  time_of_day_hint text NULL,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scene_shots_project_scene ON public.scene_shots(project_id, scene_id);
CREATE INDEX idx_scene_shots_project_version ON public.scene_shots(project_id, scene_version_id);
CREATE INDEX idx_scene_shots_project_set ON public.scene_shots(project_id, shot_set_id);
CREATE INDEX idx_scene_shots_project_status ON public.scene_shots(project_id, status);

ALTER TABLE public.scene_shots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project shots" ON public.scene_shots
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- 1.3) scene_shot_versions
CREATE TABLE public.scene_shot_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  shot_id uuid NOT NULL REFERENCES public.scene_shots(id) ON DELETE CASCADE,
  version_number int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  status text NOT NULL DEFAULT 'draft',
  supersedes_version_id uuid NULL,
  superseded_at timestamptz NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (shot_id, version_number)
);
CREATE INDEX idx_scene_shot_versions_project_shot ON public.scene_shot_versions(project_id, shot_id);
CREATE INDEX idx_scene_shot_versions_project_date ON public.scene_shot_versions(project_id, created_at DESC);

ALTER TABLE public.scene_shot_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project shot versions" ON public.scene_shot_versions
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- 1.4) storyboard_frames
CREATE TABLE public.storyboard_frames (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  scene_version_id uuid NOT NULL REFERENCES public.scene_graph_versions(id) ON DELETE CASCADE,
  shot_id uuid NOT NULL REFERENCES public.scene_shots(id) ON DELETE CASCADE,
  shot_version_id uuid NULL REFERENCES public.scene_shot_versions(id) ON DELETE SET NULL,
  frame_index int NOT NULL DEFAULT 1,
  aspect_ratio text NOT NULL DEFAULT '2.39:1',
  prompt text NOT NULL DEFAULT '',
  style_preset text NOT NULL DEFAULT 'cinematic',
  image_url text NULL,
  thumb_url text NULL,
  notes text NULL,
  status text NOT NULL DEFAULT 'draft',
  is_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_storyboard_frames_project_shot ON public.storyboard_frames(project_id, shot_id);
CREATE INDEX idx_storyboard_frames_project_version ON public.storyboard_frames(project_id, scene_version_id);
CREATE INDEX idx_storyboard_frames_project_status ON public.storyboard_frames(project_id, status);

ALTER TABLE public.storyboard_frames ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project frames" ON public.storyboard_frames
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- 1.5) production_breakdowns
CREATE TABLE public.production_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  mode text NOT NULL DEFAULT 'latest',
  source_snapshot_id uuid NULL REFERENCES public.scene_graph_snapshots(id) ON DELETE SET NULL,
  per_scene jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX idx_production_breakdowns_project ON public.production_breakdowns(project_id, created_at DESC);

ALTER TABLE public.production_breakdowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own project breakdowns" ON public.production_breakdowns
  FOR ALL USING (public.has_project_access(auth.uid(), project_id));

-- RPC for concurrency-safe shot versioning
CREATE OR REPLACE FUNCTION public.next_shot_version(
  p_shot_id uuid,
  p_project_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_propose boolean DEFAULT false,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  cur record;
  new_ver record;
  next_num integer;
  new_status text;
BEGIN
  SELECT * INTO cur
  FROM scene_shot_versions
  WHERE shot_id = p_shot_id
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  next_num := COALESCE(cur.version_number, 0) + 1;
  new_status := CASE WHEN p_propose THEN 'proposed' ELSE 'draft' END;

  INSERT INTO scene_shot_versions (
    shot_id, project_id, version_number, status, created_by, data
  ) VALUES (
    p_shot_id, p_project_id, next_num, new_status, p_created_by,
    CASE WHEN cur.data IS NOT NULL THEN cur.data || p_patch ELSE p_patch END
  )
  RETURNING * INTO new_ver;

  RETURN to_jsonb(new_ver);
END;
$$;

-- Storage bucket for storyboards
INSERT INTO storage.buckets (id, name, public)
VALUES ('storyboards', 'storyboards', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS for storyboards bucket
CREATE POLICY "Project members can manage storyboard files"
ON storage.objects FOR ALL
USING (bucket_id = 'storyboards' AND public.has_project_access(auth.uid(), (string_to_array(name, '/'))[1]::uuid))
WITH CHECK (bucket_id = 'storyboards' AND public.has_project_access(auth.uid(), (string_to_array(name, '/'))[1]::uuid));
