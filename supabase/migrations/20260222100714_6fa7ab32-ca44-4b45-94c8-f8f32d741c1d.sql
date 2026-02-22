
-- Phase 3: Project Spine + Canon Index + Scene Spine Links

-- 1.1) project_spines
CREATE TABLE IF NOT EXISTS project_spines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  mode text NOT NULL DEFAULT 'latest',
  source_snapshot_id uuid NULL,
  status text NOT NULL DEFAULT 'current',
  spine jsonb NOT NULL DEFAULT '{}'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_project_spines_project_created
  ON project_spines (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_spines_project_status
  ON project_spines (project_id, status);

ALTER TABLE project_spines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage spines for own projects"
  ON project_spines FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.2) canon_facts
CREATE TABLE IF NOT EXISTS canon_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fact_type text NOT NULL,
  subject text NOT NULL,
  predicate text NOT NULL,
  object text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL DEFAULT 0.6,
  first_scene_id uuid NULL,
  last_scene_id uuid NULL,
  first_order_key text NULL,
  last_order_key text NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canon_facts_project_type ON canon_facts (project_id, fact_type);
CREATE INDEX IF NOT EXISTS idx_canon_facts_project_subject ON canon_facts (project_id, subject);
CREATE INDEX IF NOT EXISTS idx_canon_facts_project_active ON canon_facts (project_id, is_active);

ALTER TABLE canon_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage canon facts for own projects"
  ON canon_facts FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.3) canon_overrides
CREATE TABLE IF NOT EXISTS canon_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  status text NOT NULL DEFAULT 'active',
  override jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_canon_overrides_project_status
  ON canon_overrides (project_id, status);

ALTER TABLE canon_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage canon overrides for own projects"
  ON canon_overrides FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.4) scene_spine_links
CREATE TABLE IF NOT EXISTS scene_spine_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL,
  order_key text NOT NULL,
  act int NULL,
  sequence int NULL,
  roles jsonb NOT NULL DEFAULT '[]'::jsonb,
  threads jsonb NOT NULL DEFAULT '[]'::jsonb,
  arc_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, scene_id)
);

CREATE INDEX IF NOT EXISTS idx_scene_spine_links_project_order
  ON scene_spine_links (project_id, order_key);

ALTER TABLE scene_spine_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage scene spine links for own projects"
  ON scene_spine_links FOR ALL
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- 1.5) Add columns to scene_graph_patch_queue
ALTER TABLE scene_graph_patch_queue
  ADD COLUMN IF NOT EXISTS repair_kind text NULL,
  ADD COLUMN IF NOT EXISTS impact_preview jsonb NOT NULL DEFAULT '{}'::jsonb;
