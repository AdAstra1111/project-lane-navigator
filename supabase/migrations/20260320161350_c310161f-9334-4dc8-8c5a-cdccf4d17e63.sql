
-- ══════════════════════════════════════════════════════════
-- Candidate Competition Foundation v0.5
-- Canonical substrate for persisted candidate groups,
-- versions, rankings, and winner selection.
-- ══════════════════════════════════════════════════════════

-- ── 1. candidate_groups ──
CREATE TABLE public.candidate_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  run_context_type text NOT NULL DEFAULT 'image',
  run_context_id text,
  slot_key text,
  lane text,
  asset_group text,
  character_name text,
  created_from_task_type text,
  status text NOT NULL DEFAULT 'open',
  ranking_policy_key text NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_candidate_groups_project ON public.candidate_groups (project_id);
CREATE INDEX idx_candidate_groups_status ON public.candidate_groups (project_id, status);
CREATE INDEX idx_candidate_groups_slot ON public.candidate_groups (project_id, slot_key);

ALTER TABLE public.candidate_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their project candidate groups"
  ON public.candidate_groups FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert candidate groups for their projects"
  ON public.candidate_groups FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can update their project candidate groups"
  ON public.candidate_groups FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- ── 2. candidate_versions ──
CREATE TABLE public.candidate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  version_ref_type text NOT NULL DEFAULT 'project_image',
  version_ref_id uuid NOT NULL,
  candidate_index integer NOT NULL DEFAULT 0,
  source_run_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_candidate_versions_group_ref
  ON public.candidate_versions (group_id, version_ref_id);

CREATE INDEX idx_candidate_versions_group ON public.candidate_versions (group_id);

ALTER TABLE public.candidate_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read candidate versions via group"
  ON public.candidate_versions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

CREATE POLICY "Users can insert candidate versions via group"
  ON public.candidate_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

-- ── 3. candidate_rankings ──
CREATE TABLE public.candidate_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  candidate_version_id uuid NOT NULL REFERENCES public.candidate_versions(id) ON DELETE CASCADE,
  rank_position integer NOT NULL DEFAULT 0,
  rank_score numeric NOT NULL DEFAULT 0,
  score_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ranking_inputs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ranked_at timestamptz NOT NULL DEFAULT now(),
  ranking_version_key text NOT NULL DEFAULT 'v1'
);

CREATE INDEX idx_candidate_rankings_group ON public.candidate_rankings (group_id);
CREATE INDEX idx_candidate_rankings_version ON public.candidate_rankings (group_id, ranking_version_key);

ALTER TABLE public.candidate_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read candidate rankings via group"
  ON public.candidate_rankings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

CREATE POLICY "Users can insert candidate rankings via group"
  ON public.candidate_rankings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

CREATE POLICY "Users can delete candidate rankings via group"
  ON public.candidate_rankings FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

-- ── 4. candidate_selections ──
CREATE TABLE public.candidate_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  selected_candidate_version_id uuid NOT NULL REFERENCES public.candidate_versions(id) ON DELETE CASCADE,
  selection_mode text NOT NULL DEFAULT 'manual',
  selected_by uuid,
  selected_at timestamptz NOT NULL DEFAULT now(),
  rationale text
);

-- Only one active selection per group
CREATE UNIQUE INDEX uq_candidate_selections_group
  ON public.candidate_selections (group_id);

ALTER TABLE public.candidate_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read candidate selections via group"
  ON public.candidate_selections FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

CREATE POLICY "Users can manage candidate selections via group"
  ON public.candidate_selections FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

CREATE POLICY "Users can update candidate selections via group"
  ON public.candidate_selections FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));

CREATE POLICY "Users can delete candidate selections via group"
  ON public.candidate_selections FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.candidate_groups cg
    WHERE cg.id = group_id
    AND public.has_project_access(auth.uid(), cg.project_id)
  ));
