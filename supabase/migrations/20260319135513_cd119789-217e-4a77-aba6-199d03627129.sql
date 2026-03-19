
-- Visual Truth Dependency Propagation

-- 1. visual_dependency_links — tracks what upstream truth each visual asset consumed
CREATE TABLE public.visual_dependency_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  asset_type text NOT NULL DEFAULT 'poster',
  asset_id uuid NOT NULL,
  dependency_type text NOT NULL,
  dependency_id uuid NOT NULL,
  dependency_version_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vdl_project ON public.visual_dependency_links(project_id);
CREATE INDEX idx_vdl_asset ON public.visual_dependency_links(asset_type, asset_id);
CREATE INDEX idx_vdl_dependency ON public.visual_dependency_links(dependency_type, dependency_id);

ALTER TABLE public.visual_dependency_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project deps"
  ON public.visual_dependency_links FOR SELECT
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage own project deps"
  ON public.visual_dependency_links FOR ALL
  TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- 2. Add freshness fields to project_posters
ALTER TABLE public.project_posters
  ADD COLUMN IF NOT EXISTS freshness_status text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS stale_reason text,
  ADD COLUMN IF NOT EXISTS truth_snapshot_json jsonb,
  ADD COLUMN IF NOT EXISTS dependency_hash text;

-- 3. Add freshness fields to project_images
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS freshness_status text NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS stale_reason text,
  ADD COLUMN IF NOT EXISTS truth_snapshot_json jsonb;

COMMENT ON TABLE public.visual_dependency_links IS 'Tracks upstream visual truth dependencies for all generated visual assets';
COMMENT ON COLUMN public.project_posters.freshness_status IS 'current | stale | needs_refresh | historical_locked';
COMMENT ON COLUMN public.project_posters.truth_snapshot_json IS 'Snapshot of approved truth used at generation time';
