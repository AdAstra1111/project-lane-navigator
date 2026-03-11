-- ============================================================
-- Codify prod-only enrichment columns on scene_graph_versions
-- and prod-only columns on scene_graph_scenes
-- ============================================================
--
-- EVIDENCE (schema_drift_audit, 2026-03-11):
--
-- scene_graph_versions had 26 columns in production vs 14 in the original
-- migration. All 12 additional columns are actively referenced in dev-engine-v2
-- and _shared/sceneRoleClassifier.ts. They were added via Lovable and are the
-- core enrichment surface for the scene classification and NIT pipelines.
--
-- scene_graph_scenes had 2 prod-only columns:
--   - scene_key: codified in 20260311210000 (NOT NULL + unique index)
--   - provenance: jsonb NOT NULL DEFAULT '{}' — actively used (12 refs in dev-engine-v2)
--
-- All ADD COLUMN IF NOT EXISTS — safe to apply over existing production schema.
-- For columns that already exist, the statement is a no-op.

-- ── scene_graph_versions enrichment columns ───────────────────────────────────

-- Character presence — populated by syncSceneEntityLinksForProject / role classifier
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS characters_present jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Scene role taxonomy — populated by scene_graph_classify_roles_heuristic
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS scene_roles jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Structural beats — populated by scene analysis engine
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS beats jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Thread tracking — populated by rewrite and spine engine
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS thread_links jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Continuity tracking — emitted and required facts per scene
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS continuity_facts_emitted jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS continuity_facts_required jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Setup/payoff tracking
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS setup_payoff_emitted jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS setup_payoff_required jsonb NOT NULL DEFAULT '[]'::jsonb;

-- General metadata bag — engine-populated key/value annotations
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Narrative purpose tag — nullable free-text classification
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS purpose text NULL;

-- Tension and pacing — nullable numeric signals
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS tension_delta integer NULL;
ALTER TABLE public.scene_graph_versions
  ADD COLUMN IF NOT EXISTS pacing_seconds integer NULL;

-- ── scene_graph_scenes: provenance ────────────────────────────────────────────
-- Tracks origin of scene (extraction, split, merge, change_set).
-- scene_key is codified in 20260311210000 — not repeated here.

ALTER TABLE public.scene_graph_scenes
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Column comments for active enrichment columns
COMMENT ON COLUMN public.scene_graph_versions.characters_present IS
  'Deterministic character list from syncSceneEntityLinksForProject. Array of entity canonical names.';
COMMENT ON COLUMN public.scene_graph_versions.scene_roles IS
  'Scene role taxonomy tags from scene_graph_classify_roles_heuristic. Array of role keys.';
COMMENT ON COLUMN public.scene_graph_versions.beats IS
  'Structural beat sequence for this scene version. Populated by scene analysis engine.';
COMMENT ON COLUMN public.scene_graph_versions.thread_links IS
  'Narrative thread references. Populated by rewrite and spine engine.';
COMMENT ON COLUMN public.scene_graph_scenes.provenance IS
  'Origin metadata: extraction source, split/merge parentage, change_set_id. Set at creation.';
