
-- Phase 2: Scene Graph tables + columns

-- 1.1) Add columns to scene_graph_versions (script_scene_versions equivalent)
ALTER TABLE scene_graph_versions
  ADD COLUMN IF NOT EXISTS supersedes_version_id uuid NULL,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz NULL;

-- 1.2) Action log for undo
CREATE TABLE IF NOT EXISTS scene_graph_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  actor_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  inverse jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scene_graph_actions_project_created
  ON scene_graph_actions (project_id, created_at DESC);

ALTER TABLE scene_graph_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage scene graph actions for own projects"
  ON scene_graph_actions FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.3) Patch suggestion queue
CREATE TABLE IF NOT EXISTS scene_graph_patch_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  status text NOT NULL DEFAULT 'open',
  source_action_id uuid NULL REFERENCES scene_graph_actions(id) ON DELETE SET NULL,
  target_scene_id uuid NULL REFERENCES scene_graph_scenes(id) ON DELETE SET NULL,
  target_scene_version_id uuid NULL REFERENCES scene_graph_versions(id) ON DELETE SET NULL,
  suggestion text NOT NULL DEFAULT '',
  rationale text NULL,
  patch jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_scene_graph_patch_queue_project
  ON scene_graph_patch_queue (project_id, status, created_at DESC);

ALTER TABLE scene_graph_patch_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage patch queue for own projects"
  ON scene_graph_patch_queue FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.4) Concurrency-safe version creation RPC
CREATE OR REPLACE FUNCTION public.next_scene_version(
  p_scene_id uuid,
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
  -- Lock latest version row
  SELECT * INTO cur
  FROM scene_graph_versions
  WHERE scene_id = p_scene_id
  ORDER BY version_number DESC
  LIMIT 1
  FOR UPDATE;

  next_num := COALESCE(cur.version_number, 0) + 1;
  new_status := CASE WHEN p_propose THEN 'proposed' ELSE 'draft' END;

  INSERT INTO scene_graph_versions (
    scene_id, project_id, version_number, status, created_by,
    slugline, location, time_of_day, characters_present, purpose,
    beats, summary, content,
    continuity_facts_emitted, continuity_facts_required,
    setup_payoff_emitted, setup_payoff_required, metadata
  ) VALUES (
    p_scene_id, p_project_id, next_num, new_status, p_created_by,
    COALESCE(p_patch->>'slugline', cur.slugline),
    COALESCE(cur.location, ''),
    COALESCE(cur.time_of_day, ''),
    CASE WHEN p_patch ? 'characters_present' THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'characters_present')) ELSE COALESCE(cur.characters_present, '{}') END,
    cur.purpose,
    CASE WHEN p_patch ? 'beats' THEN (p_patch->'beats') ELSE COALESCE(to_jsonb(cur.beats), '[]'::jsonb) END,
    COALESCE(p_patch->>'summary', cur.summary),
    COALESCE(p_patch->>'content', cur.content, ''),
    COALESCE(to_jsonb(cur.continuity_facts_emitted), '[]'::jsonb),
    COALESCE(to_jsonb(cur.continuity_facts_required), '[]'::jsonb),
    COALESCE(to_jsonb(cur.setup_payoff_emitted), '[]'::jsonb),
    COALESCE(to_jsonb(cur.setup_payoff_required), '[]'::jsonb),
    COALESCE(cur.metadata, '{}'::jsonb)
  )
  RETURNING * INTO new_ver;

  RETURN to_jsonb(new_ver);
END;
$$;
