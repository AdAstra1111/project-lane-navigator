-- ============================================================
-- RLS Policies — Narrative Entity Tables
-- ============================================================
--
-- EVIDENCE BASIS (schema_drift_audit + get_policy_predicates, 2026-03-11):
--
-- All 4 target tables have RLS enabled but zero policies.
-- PostgreSQL default-deny: authenticated-JWT queries return 0 rows.
-- Service-role (edge functions) bypasses RLS — backend writes unaffected.
--
-- All 4 tables have direct project_id columns:
--   narrative_entities:          project_id NOT NULL FK → projects
--   narrative_entity_mentions:   project_id NOT NULL FK → projects
--   narrative_entity_relations:  project_id NOT NULL FK → projects
--   narrative_scene_entity_links: project_id NOT NULL FK → projects
--
-- CANONICAL PATTERN (from narrative_units, scene_graph_scenes, et al.):
--   USING:      has_project_access(auth.uid(), project_id)
--   WITH CHECK: has_project_access(auth.uid(), project_id)
-- All existing project-scoped tables use this exact predicate.
--
-- WRITE SEMANTICS PER TABLE:
--
--   narrative_entities — full CRUD for authenticated users.
--     Rationale: source_kind IN ('project_canon','spine_axis','manual') — the
--     'manual' source_kind explicitly supports user-created entities, consistent
--     with narrative_units which also has full CRUD for authenticated users.
--
--   narrative_scene_entity_links — SELECT only for authenticated users.
--     Rationale: purely pipeline-derived (syncSceneEntityLinksForProject from
--     deterministic character detection). User writes would corrupt pipeline state.
--     Backend writes use service_role (RLS bypassed). No frontend writes needed.
--
--   narrative_entity_mentions — SELECT only for authenticated users.
--     Rationale: purely pipeline-derived (NIT upsert from document version scans).
--     User writes would corrupt mention tracking. Service_role handles all writes.
--
--   narrative_entity_relations — SELECT only for authenticated users.
--     Rationale: pipeline-derived (NIT relation derivation from canon/spine axes).
--     Manual relation creation is architecturally possible in future, but no
--     current code path requires it. SELECT-only is safe and conservative.
--     Upgrade to full CRUD in a future pass when manual relation UX is designed.
--
-- FRONTEND BLAST RADIUS AFTER THIS MIGRATION:
--   + Authenticated users can read narrative entities, mentions, relations,
--     and scene-entity links for projects they have access to.
--   + Authenticated users can INSERT/UPDATE/DELETE narrative_entities only.
--   - No new write paths for the other 3 tables from frontend.
--   ↔ Service-role flows completely unaffected (bypass RLS).
--
-- NO OVER-PERMISSION:
--   scene-entity links, mentions, relations remain write-blocked for user JWTs.
--   This matches the principle that pipeline-derived data is not user-editable.

-- ── narrative_entities ────────────────────────────────────────────────────────

CREATE POLICY "ne_select"
  ON public.narrative_entities
  FOR SELECT
  TO authenticated
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "ne_insert"
  ON public.narrative_entities
  FOR INSERT
  TO authenticated
  WITH CHECK (has_project_access(auth.uid(), project_id));

CREATE POLICY "ne_update"
  ON public.narrative_entities
  FOR UPDATE
  TO authenticated
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "ne_delete"
  ON public.narrative_entities
  FOR DELETE
  TO authenticated
  USING (has_project_access(auth.uid(), project_id));

-- ── narrative_entity_mentions — SELECT only ───────────────────────────────────
-- Pipeline-derived. User writes not permitted.

CREATE POLICY "nem_select"
  ON public.narrative_entity_mentions
  FOR SELECT
  TO authenticated
  USING (has_project_access(auth.uid(), project_id));

-- ── narrative_entity_relations — SELECT only ─────────────────────────────────
-- Pipeline-derived. User writes not permitted for now.
-- Upgrade to full CRUD in a future pass when manual relation UX is designed.

CREATE POLICY "ner_select"
  ON public.narrative_entity_relations
  FOR SELECT
  TO authenticated
  USING (has_project_access(auth.uid(), project_id));

-- ── narrative_scene_entity_links — SELECT only ────────────────────────────────
-- Purely pipeline-derived (syncSceneEntityLinksForProject).
-- User writes would corrupt deterministic character presence state.

CREATE POLICY "nsel_select"
  ON public.narrative_scene_entity_links
  FOR SELECT
  TO authenticated
  USING (has_project_access(auth.uid(), project_id));
