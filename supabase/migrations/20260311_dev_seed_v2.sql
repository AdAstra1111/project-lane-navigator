-- ============================================================
-- Dev Seed v2 — Story Genome System
-- Installment: IFFY Dev Seed v2 Architecture
--
-- 9 tables across 8 layers. All reference project_id + seed_id.
-- seed_id = dev_seed_v2_projects.id (the root row for each seed).
-- ON DELETE CASCADE from dev_seed_v2_projects propagates to all child layers.
-- RLS follows has_project_access() pattern matching existing tables.
-- gen_random_uuid() used for default IDs (confirmed available).
-- ============================================================

-- ── Layer 1: Project Identity ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_projects (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by        UUID,
  title             TEXT        NOT NULL,
  lane              TEXT,
  format            TEXT,
  target_audience   TEXT,
  genre_stack       TEXT[]      DEFAULT '{}',
  tone_contract     TEXT,
  market_hook       TEXT,
  runtime_pattern   TEXT,
  episode_pattern   TEXT,
  comparable_mode   TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 2: Premise Kernel ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_premise (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id           UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id        UUID        NOT NULL,
  premise           TEXT,
  dramatic_question TEXT,
  central_irony     TEXT,
  emotional_promise TEXT,
  audience_fantasy  TEXT,
  audience_fear     TEXT,
  theme_vector      TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 3: Narrative Axes ───────────────────────────────────────────────────
-- axis_key maps to SpineAxis from narrativeSpine.ts + NDG graph.
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_axes (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id          UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id       UUID        NOT NULL,
  axis_key         TEXT        NOT NULL,
  axis_statement   TEXT,
  axis_role        TEXT,
  axis_priority    INTEGER     DEFAULT 0,
  axis_confidence  NUMERIC     DEFAULT 1.0,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 4: Narrative Units ──────────────────────────────────────────────────
-- Maps to canon_units / narrative_units for downstream sync.
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_units (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id                  UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id               UUID        NOT NULL,
  unit_key                 TEXT        NOT NULL,
  unit_type                TEXT        NOT NULL,
  axis_source              TEXT,
  unit_statement           TEXT,
  success_state            TEXT,
  failure_mode             TEXT,
  dependency_position      TEXT,
  initial_alignment_status TEXT        DEFAULT 'aligned',
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 5a: Entity Graph — Entities ─────────────────────────────────────────
-- Maps cleanly to narrative_entities for downstream sync.
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_entities (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id             UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id          UUID        NOT NULL,
  entity_key          TEXT        NOT NULL,
  entity_name         TEXT        NOT NULL,
  entity_type         TEXT        NOT NULL,
  narrative_role      TEXT,
  description         TEXT,
  aliases             TEXT[]      DEFAULT '{}',
  story_critical_flag BOOLEAN     DEFAULT false,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 5b: Entity Graph — Relations ───────────────────────────────────────
-- Uses entity_key strings (not UUIDs) since entities may not yet be in
-- narrative_entities at seed time. Downstream sync resolves to IDs.
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_entity_relations (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id           UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id        UUID        NOT NULL,
  source_entity_key TEXT        NOT NULL,
  relation_type     TEXT        NOT NULL,
  target_entity_key TEXT        NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 6: Canon Rules ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_canon_rules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id          UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id       UUID        NOT NULL,
  rule_key         TEXT        NOT NULL,
  rule_description TEXT        NOT NULL,
  rule_scope       TEXT,
  severity         TEXT        DEFAULT 'moderate',
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 7: Structural Beat Seeds ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_beats (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id                  UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id               UUID        NOT NULL,
  beat_key                 TEXT        NOT NULL,
  beat_description         TEXT,
  narrative_axis_reference TEXT,
  expected_turn            TEXT,
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- ── Layer 8: Generation Intent ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dev_seed_v2_generation_intent (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  seed_id                    UUID        NOT NULL REFERENCES public.dev_seed_v2_projects(id) ON DELETE CASCADE,
  project_id                 UUID        NOT NULL,
  projection_targets         TEXT[]      DEFAULT '{}',
  pacing_bias                TEXT,
  dialogue_density           TEXT,
  mystery_opacity            TEXT,
  commercial_vs_auteur_scale NUMERIC,
  tone_intensity             TEXT,
  created_at                 TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes for common lookup patterns ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS dev_seed_v2_projects_project_id_idx  ON public.dev_seed_v2_projects(project_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_premise_seed_id_idx      ON public.dev_seed_v2_premise(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_axes_seed_id_idx         ON public.dev_seed_v2_axes(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_units_seed_id_idx        ON public.dev_seed_v2_units(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_entities_seed_id_idx     ON public.dev_seed_v2_entities(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_entity_relations_seed_id_idx ON public.dev_seed_v2_entity_relations(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_canon_rules_seed_id_idx  ON public.dev_seed_v2_canon_rules(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_beats_seed_id_idx        ON public.dev_seed_v2_beats(seed_id);
CREATE INDEX IF NOT EXISTS dev_seed_v2_generation_intent_seed_id_idx ON public.dev_seed_v2_generation_intent(seed_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
-- Pattern: matches narrative_entities (has_project_access for select/update/delete,
-- service role insert via WITH CHECK (true)).

ALTER TABLE public.dev_seed_v2_projects         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_premise          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_axes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_units            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_entities         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_entity_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_canon_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_beats            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dev_seed_v2_generation_intent ENABLE ROW LEVEL SECURITY;

-- dev_seed_v2_projects
CREATE POLICY dsv2_projects_select ON public.dev_seed_v2_projects FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_projects_insert ON public.dev_seed_v2_projects FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_projects_update ON public.dev_seed_v2_projects FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_projects_delete ON public.dev_seed_v2_projects FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_premise
CREATE POLICY dsv2_premise_select ON public.dev_seed_v2_premise FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_premise_insert ON public.dev_seed_v2_premise FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_premise_update ON public.dev_seed_v2_premise FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_premise_delete ON public.dev_seed_v2_premise FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_axes
CREATE POLICY dsv2_axes_select ON public.dev_seed_v2_axes FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_axes_insert ON public.dev_seed_v2_axes FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_axes_update ON public.dev_seed_v2_axes FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_axes_delete ON public.dev_seed_v2_axes FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_units
CREATE POLICY dsv2_units_select ON public.dev_seed_v2_units FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_units_insert ON public.dev_seed_v2_units FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_units_update ON public.dev_seed_v2_units FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_units_delete ON public.dev_seed_v2_units FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_entities
CREATE POLICY dsv2_entities_select ON public.dev_seed_v2_entities FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_entities_insert ON public.dev_seed_v2_entities FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_entities_update ON public.dev_seed_v2_entities FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_entities_delete ON public.dev_seed_v2_entities FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_entity_relations
CREATE POLICY dsv2_er_select ON public.dev_seed_v2_entity_relations FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_er_insert ON public.dev_seed_v2_entity_relations FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_er_update ON public.dev_seed_v2_entity_relations FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_er_delete ON public.dev_seed_v2_entity_relations FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_canon_rules
CREATE POLICY dsv2_rules_select ON public.dev_seed_v2_canon_rules FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_rules_insert ON public.dev_seed_v2_canon_rules FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_rules_update ON public.dev_seed_v2_canon_rules FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_rules_delete ON public.dev_seed_v2_canon_rules FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_beats
CREATE POLICY dsv2_beats_select ON public.dev_seed_v2_beats FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_beats_insert ON public.dev_seed_v2_beats FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_beats_update ON public.dev_seed_v2_beats FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_beats_delete ON public.dev_seed_v2_beats FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- dev_seed_v2_generation_intent
CREATE POLICY dsv2_intent_select ON public.dev_seed_v2_generation_intent FOR SELECT USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_intent_insert ON public.dev_seed_v2_generation_intent FOR INSERT WITH CHECK (true);
CREATE POLICY dsv2_intent_update ON public.dev_seed_v2_generation_intent FOR UPDATE USING (has_project_access(auth.uid(), project_id));
CREATE POLICY dsv2_intent_delete ON public.dev_seed_v2_generation_intent FOR DELETE USING (has_project_access(auth.uid(), project_id));

-- ── Singleton enforcement (DS2A architectural audit) ──────────────────────────
-- One active seed per project. Matches project_canon singleton pattern.
-- If versioning is needed in future, add dev_seed_v2_history (append-only).
ALTER TABLE public.dev_seed_v2_projects
  ADD CONSTRAINT dev_seed_v2_projects_project_id_unique UNIQUE (project_id);

-- ── DS2B: Promotion tracking (additive) ──────────────────────────────────────
ALTER TABLE public.dev_seed_v2_projects
  ADD COLUMN IF NOT EXISTS promoted_at        TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS promotion_summary  JSONB       DEFAULT NULL;

-- ── DS2B: Extend narrative_entities.source_kind for dev_seed_v2 ───────────────
-- Additive change — preserves all existing source_kind values.
-- Justified: dev_seed_v2 is a distinct, auditable origin source.
ALTER TABLE public.narrative_entities DROP CONSTRAINT IF EXISTS narrative_entities_source_kind_check;
ALTER TABLE public.narrative_entities ADD CONSTRAINT narrative_entities_source_kind_check
  CHECK (source_kind = ANY (ARRAY[
    'project_canon'::text, 'spine_axis'::text, 'manual'::text, 'dev_seed_v2'::text
  ]));

-- ── DS2B: Extend narrative_entity_relations constraints for seed promotion ────
-- relation_type: add the full ALLOWED_PROPAGATION_RELATIONS set used by NDG planner
-- source_kind: add dev_seed_v2 as a valid auditable origin
ALTER TABLE public.narrative_entity_relations
  DROP CONSTRAINT IF EXISTS narrative_entity_relations_relation_type_check;
ALTER TABLE public.narrative_entity_relations
  ADD CONSTRAINT narrative_entity_relations_relation_type_check
  CHECK (relation_type = ANY (ARRAY[
    'drives_arc', 'subject_of_conflict', 'opposes',
    'conflicts_with', 'allied_with', 'mentor_of', 'family_of'
  ]));
ALTER TABLE public.narrative_entity_relations
  DROP CONSTRAINT IF EXISTS narrative_entity_relations_source_kind_check;
ALTER TABLE public.narrative_entity_relations
  ADD CONSTRAINT narrative_entity_relations_source_kind_check
  CHECK (source_kind = ANY (ARRAY[
    'canon_sync', 'spine_derivation', 'manual', 'dev_seed_v2'
  ]));
