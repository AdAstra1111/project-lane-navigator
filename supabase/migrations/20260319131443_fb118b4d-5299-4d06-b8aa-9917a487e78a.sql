
-- ═══════════════════════════════════════════════════════════════════════════════
-- CANONICAL STORY INGESTION ENGINE — Schema
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. story_ingestion_runs — audit container for every ingestion event ──────
CREATE TABLE IF NOT EXISTS public.story_ingestion_runs (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_kind          text        NOT NULL DEFAULT 'feature_script',
  source_document_ids  uuid[]      NOT NULL DEFAULT '{}',
  source_version_ids   uuid[]      NOT NULL DEFAULT '{}',
  status               text        NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','parsing','extracting','reconciling','distributing','completed','failed','superseded')),
  stage_summary        jsonb       NOT NULL DEFAULT '{}',
  manifest_json        jsonb       NOT NULL DEFAULT '{}',
  failure_reason       text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz,
  superseded_by        uuid        REFERENCES public.story_ingestion_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_project ON public.story_ingestion_runs(project_id, created_at DESC);
ALTER TABLE public.story_ingestion_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sir_select" ON public.story_ingestion_runs FOR SELECT TO authenticated
  USING (has_project_access(auth.uid(), project_id));
CREATE POLICY "sir_insert" ON public.story_ingestion_runs FOR INSERT TO authenticated
  WITH CHECK (has_project_access(auth.uid(), project_id));
CREATE POLICY "sir_update" ON public.story_ingestion_runs FOR UPDATE TO authenticated
  USING (has_project_access(auth.uid(), project_id));
CREATE POLICY "sir_service" ON public.story_ingestion_runs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 2. Extend narrative_entities source_kind for ingestion pipeline ──────────
ALTER TABLE public.narrative_entities DROP CONSTRAINT IF EXISTS narrative_entities_source_kind_check;
ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_source_kind_check
  CHECK (source_kind = ANY (ARRAY[
    'project_canon','spine_axis','manual','dev_seed_v2','story_ingestion'
  ]));

-- ── 3. scene_entity_participation — richer than narrative_scene_entity_links ─
CREATE TABLE IF NOT EXISTS public.scene_entity_participation (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ingestion_run_id  uuid        REFERENCES public.story_ingestion_runs(id) ON DELETE SET NULL,
  scene_id          uuid        NOT NULL REFERENCES public.scene_graph_scenes(id) ON DELETE CASCADE,
  entity_id         uuid        NOT NULL REFERENCES public.narrative_entities(id) ON DELETE CASCADE,
  entity_type       text        NOT NULL DEFAULT 'character',
  role_in_scene     text        NOT NULL DEFAULT 'present',
  is_primary        boolean     NOT NULL DEFAULT false,
  costume_note      text,
  state_note         text,
  confidence        numeric     NOT NULL DEFAULT 0.8,
  source_reason     text        NOT NULL DEFAULT 'extracted',
  review_tier       text        NOT NULL DEFAULT 'auto_accepted'
    CHECK (review_tier IN ('auto_accepted','review_required','proposed_only')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scene_id, entity_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_sep_scene ON public.scene_entity_participation(scene_id);
CREATE INDEX IF NOT EXISTS idx_sep_entity ON public.scene_entity_participation(entity_id);
ALTER TABLE public.scene_entity_participation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sep_select" ON public.scene_entity_participation FOR SELECT TO authenticated
  USING (has_project_access(auth.uid(), project_id));
CREATE POLICY "sep_service" ON public.scene_entity_participation FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 4. entity_aliases — reconciliation/alias tracking ────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_aliases (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  canonical_entity_id uuid      NOT NULL REFERENCES public.narrative_entities(id) ON DELETE CASCADE,
  alias_name        text        NOT NULL,
  normalized_alias  text        NOT NULL,
  source            text        NOT NULL DEFAULT 'auto',
  confidence        numeric     NOT NULL DEFAULT 0.8,
  review_status     text        NOT NULL DEFAULT 'auto_accepted'
    CHECK (review_status IN ('auto_accepted','review_required','rejected','confirmed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, normalized_alias)
);

ALTER TABLE public.entity_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ea_select" ON public.entity_aliases FOR SELECT TO authenticated
  USING (has_project_access(auth.uid(), project_id));
CREATE POLICY "ea_service" ON public.entity_aliases FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 5. state_transition_candidates — extracted state changes linked to scenes ─
CREATE TABLE IF NOT EXISTS public.state_transition_candidates (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ingestion_run_id  uuid        REFERENCES public.story_ingestion_runs(id) ON DELETE SET NULL,
  entity_id         uuid        NOT NULL REFERENCES public.narrative_entities(id) ON DELETE CASCADE,
  entity_type       text        NOT NULL DEFAULT 'character',
  from_state_key    text,
  to_state_key      text        NOT NULL,
  state_category    text        NOT NULL DEFAULT 'transformation',
  scene_id          uuid        REFERENCES public.scene_graph_scenes(id) ON DELETE SET NULL,
  evidence_text     text,
  confidence        numeric     NOT NULL DEFAULT 0.6,
  review_tier       text        NOT NULL DEFAULT 'review_required'
    CHECK (review_tier IN ('auto_accepted','review_required','proposed_only')),
  promoted_to_evs_id uuid      REFERENCES public.entity_visual_states(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.state_transition_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stc_select" ON public.state_transition_candidates FOR SELECT TO authenticated
  USING (has_project_access(auth.uid(), project_id));
CREATE POLICY "stc_service" ON public.state_transition_candidates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── 6. Add ingestion_run_id to narrative_entities for provenance ─────────────
ALTER TABLE public.narrative_entities ADD COLUMN IF NOT EXISTS ingestion_run_id uuid
  REFERENCES public.story_ingestion_runs(id) ON DELETE SET NULL;

-- ── 7. Add ingestion_run_id to scene_graph_scenes for provenance ─────────────
ALTER TABLE public.scene_graph_scenes ADD COLUMN IF NOT EXISTS ingestion_run_id uuid
  REFERENCES public.story_ingestion_runs(id) ON DELETE SET NULL;
