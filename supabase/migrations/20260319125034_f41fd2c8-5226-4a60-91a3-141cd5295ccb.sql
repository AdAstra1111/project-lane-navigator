
-- ═══════════════════════════════════════════════════════════════
-- 1. Structured Canon Locations table
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.canon_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  location_type text NOT NULL DEFAULT 'location',
  interior_or_exterior text,
  geography text,
  era_relevance text,
  story_importance text NOT NULL DEFAULT 'secondary',
  recurring boolean NOT NULL DEFAULT false,
  description text,
  associated_characters text[] NOT NULL DEFAULT '{}',
  source_document_ids text[] NOT NULL DEFAULT '{}',
  provenance text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, normalized_name)
);

ALTER TABLE public.canon_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project locations"
ON public.canon_locations FOR ALL TO authenticated
USING (public.has_project_access(auth.uid(), project_id))
WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_canon_locations_project ON public.canon_locations(project_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. Entity Visual States table (story-aware state variants)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.entity_visual_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('character', 'location', 'object')),
  entity_name text NOT NULL,
  entity_id uuid,
  state_key text NOT NULL,
  state_label text NOT NULL,
  state_category text NOT NULL,
  parent_state_id uuid REFERENCES public.entity_visual_states(id),
  canonical_description text,
  source_reason text,
  story_phase text,
  confidence text NOT NULL DEFAULT 'proposed',
  approved_by uuid,
  approved_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, entity_type, entity_name, state_key)
);

ALTER TABLE public.entity_visual_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project entity states"
ON public.entity_visual_states FOR ALL TO authenticated
USING (public.has_project_access(auth.uid(), project_id))
WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE INDEX idx_entity_visual_states_project ON public.entity_visual_states(project_id, entity_type, entity_name);

-- ═══════════════════════════════════════════════════════════════
-- 3. Add entity_state_id to visual_sets for state-aware sets
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.visual_sets 
  ADD COLUMN IF NOT EXISTS entity_state_id uuid REFERENCES public.entity_visual_states(id),
  ADD COLUMN IF NOT EXISTS entity_state_key text;

CREATE INDEX IF NOT EXISTS idx_visual_sets_entity_state ON public.visual_sets(entity_state_id);
