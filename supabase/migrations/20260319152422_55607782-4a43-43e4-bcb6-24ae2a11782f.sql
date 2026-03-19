
-- Add canon_location_id to scene_graph_versions for deterministic scene→location binding
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS canon_location_id UUID REFERENCES public.canon_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sgv_canon_location_id ON public.scene_graph_versions(canon_location_id) WHERE canon_location_id IS NOT NULL;

-- Add canon_location_id to project_images for deterministic image→location binding
ALTER TABLE public.project_images
  ADD COLUMN IF NOT EXISTS canon_location_id UUID REFERENCES public.canon_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pi_canon_location_id ON public.project_images(canon_location_id) WHERE canon_location_id IS NOT NULL;
