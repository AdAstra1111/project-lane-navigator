
-- Visual similarity cache table
-- Persists anchor-to-candidate AI vision comparison results
-- Cache key: candidate_image_id + anchor_hash (sorted anchor image IDs) + scoring_version
CREATE TABLE public.visual_similarity_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  candidate_image_id uuid NOT NULL,
  character_name text NOT NULL DEFAULT '',
  anchor_hash text NOT NULL,
  anchor_context text NOT NULL DEFAULT 'no_anchors',
  anchor_image_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scoring_version text NOT NULL DEFAULT 'v1',
  dimensions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  composite_score integer NOT NULL DEFAULT 50,
  is_actionable boolean NOT NULL DEFAULT false,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint = cache key
CREATE UNIQUE INDEX uq_visual_similarity_cache_key
  ON public.visual_similarity_cache (candidate_image_id, anchor_hash, scoring_version);

-- Lookup index
CREATE INDEX idx_visual_similarity_cache_project
  ON public.visual_similarity_cache (project_id);

-- RLS
ALTER TABLE public.visual_similarity_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read similarity cache for their projects"
  ON public.visual_similarity_cache FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert similarity cache for their projects"
  ON public.visual_similarity_cache FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can delete similarity cache for their projects"
  ON public.visual_similarity_cache FOR DELETE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
