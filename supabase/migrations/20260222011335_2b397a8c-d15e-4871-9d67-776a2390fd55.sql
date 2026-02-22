
-- ============================================================
-- IFFY Scene Graph: New tables with scene_graph_ prefix
-- ============================================================

-- 1.1 scene_graph_scenes
CREATE TABLE public.scene_graph_scenes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_kind text NOT NULL DEFAULT 'narrative',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  deprecated_at timestamptz NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_sg_scenes_project ON public.scene_graph_scenes(project_id);

-- 1.2 scene_graph_versions
CREATE TABLE public.scene_graph_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id uuid NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  version_number int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  slugline text NULL,
  location text NULL,
  time_of_day text NULL,
  characters_present jsonb NOT NULL DEFAULT '[]'::jsonb,
  purpose text NULL,
  beats jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NULL,
  content text NOT NULL DEFAULT '',
  continuity_facts_emitted jsonb NOT NULL DEFAULT '[]'::jsonb,
  continuity_facts_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  setup_payoff_emitted jsonb NOT NULL DEFAULT '[]'::jsonb,
  setup_payoff_required jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(scene_id, version_number)
);
CREATE INDEX idx_sg_versions_scene ON public.scene_graph_versions(scene_id);
CREATE INDEX idx_sg_versions_project ON public.scene_graph_versions(project_id);

-- 1.3 scene_graph_order
CREATE TABLE public.scene_graph_order (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  scene_id uuid NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  order_key text NOT NULL,
  act int NULL,
  sequence int NULL,
  is_active boolean NOT NULL DEFAULT true,
  inserted_reason text NULL,
  inserted_intent jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sg_order_project_key ON public.scene_graph_order(project_id, order_key);
CREATE INDEX idx_sg_order_active ON public.scene_graph_order(project_id, is_active);

-- 1.4 scene_graph_snapshots
CREATE TABLE public.scene_graph_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  label text NULL,
  assembly jsonb NOT NULL DEFAULT '{}'::jsonb,
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
);
CREATE INDEX idx_sg_snapshots_project ON public.scene_graph_snapshots(project_id);

-- RLS
ALTER TABLE public.scene_graph_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_graph_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_graph_order ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_graph_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sg_scenes_select" ON public.scene_graph_scenes FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_scenes_insert" ON public.scene_graph_scenes FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_scenes_update" ON public.scene_graph_scenes FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_scenes_delete" ON public.scene_graph_scenes FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "sg_versions_select" ON public.scene_graph_versions FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_versions_insert" ON public.scene_graph_versions FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_versions_update" ON public.scene_graph_versions FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_versions_delete" ON public.scene_graph_versions FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "sg_order_select" ON public.scene_graph_order FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_order_insert" ON public.scene_graph_order FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_order_update" ON public.scene_graph_order FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_order_delete" ON public.scene_graph_order FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "sg_snapshots_select" ON public.scene_graph_snapshots FOR SELECT TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_snapshots_insert" ON public.scene_graph_snapshots FOR INSERT TO authenticated WITH CHECK (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_snapshots_update" ON public.scene_graph_snapshots FOR UPDATE TO authenticated USING (public.has_project_access(auth.uid(), project_id));
CREATE POLICY "sg_snapshots_delete" ON public.scene_graph_snapshots FOR DELETE TO authenticated USING (public.has_project_access(auth.uid(), project_id));

-- 1.6 Backfill helper view
CREATE OR REPLACE VIEW public.project_script_scene_state AS
SELECT
  p.id AS project_id,
  EXISTS (SELECT 1 FROM public.scene_graph_scenes ss WHERE ss.project_id = p.id) AS has_scenes,
  COALESCE((SELECT count(*)::int FROM public.scene_graph_order so WHERE so.project_id = p.id AND so.is_active = true), 0) AS active_scene_count,
  (SELECT sn.id FROM public.scene_graph_snapshots sn WHERE sn.project_id = p.id ORDER BY sn.created_at DESC LIMIT 1) AS latest_snapshot_id,
  (SELECT sn.status FROM public.scene_graph_snapshots sn WHERE sn.project_id = p.id ORDER BY sn.created_at DESC LIMIT 1) AS latest_snapshot_status
FROM public.projects p;
