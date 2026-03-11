-- Scene Blueprint Binding Layer v1
--
-- Persists deterministic scene-level patch targets derived from:
--   narrative_units (contradicted/stale)
--   → NDG propagation
--   → scene_spine_links.axis_key
--   → scene identity
--
-- One row per (project_id, scene_id, source_axis).
-- Rebuilt on each derive run (idempotent via ON CONFLICT UPDATE).
-- Advisory only — no patch execution semantics.
-- Additive: no existing tables modified.

CREATE TABLE IF NOT EXISTS public.scene_blueprint_bindings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID    NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Scene identity (immutable anchors)
  scene_id              UUID    NOT NULL,                   -- scene_graph_scenes.id
  scene_key             TEXT    NOT NULL,                   -- denorm: SCENE_NNN

  -- Source of the binding (which spine axis triggered it)
  source_axis           TEXT    NOT NULL,                   -- spine axis key (e.g. protagonist_arc)

  -- Upstream provenance
  source_unit_key       TEXT    NULL,                       -- narrative_units.unit_key that triggered
  source_doc_version_id UUID    NULL
    REFERENCES public.project_document_versions(id) ON DELETE SET NULL,

  -- Risk classification
  risk_source           TEXT    NOT NULL DEFAULT 'direct',  -- 'direct' | 'propagated'

  -- Patch advisory fields (deterministic vocabulary, v1)
  patch_intent          TEXT    NOT NULL DEFAULT 'inspect', -- 'inspect' | 'reinforce' | 'revise'
  target_surface        TEXT    NOT NULL DEFAULT 'screenplay', -- 'screenplay' (v1 scope)

  -- Human-readable provenance
  slugline              TEXT    NULL,                       -- latest scene version slugline (denorm)
  reason                TEXT    NULL,                       -- source unit contradiction_note / stale reason

  -- Idempotency / audit
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One binding per project × scene × source_axis
  UNIQUE (project_id, scene_id, source_axis)
);

CREATE INDEX IF NOT EXISTS idx_scene_blueprint_bindings_project
  ON public.scene_blueprint_bindings (project_id);

CREATE INDEX IF NOT EXISTS idx_scene_blueprint_bindings_scene
  ON public.scene_blueprint_bindings (project_id, scene_id);

CREATE INDEX IF NOT EXISTS idx_scene_blueprint_bindings_axis
  ON public.scene_blueprint_bindings (project_id, source_axis);

ALTER TABLE public.scene_blueprint_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read scene blueprint bindings for accessible projects"
  ON public.scene_blueprint_bindings FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can manage scene blueprint bindings for accessible projects"
  ON public.scene_blueprint_bindings FOR ALL TO authenticated
  USING (public.has_project_access(auth.uid(), project_id))
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

COMMENT ON TABLE public.scene_blueprint_bindings IS
  'Scene Blueprint Binding Layer v1. Persists deterministic scene-level patch targets derived from narrative_units risk × NDG propagation × scene_spine_links. Advisory only — no execution semantics. One row per (project_id, scene_id, source_axis). Rebuilt idempotently by scene_derive_blueprint_bindings action.';

COMMENT ON COLUMN public.scene_blueprint_bindings.patch_intent IS
  'inspect = monitor, no immediate action. reinforce = strengthen alignment. revise = structural change required.';

COMMENT ON COLUMN public.scene_blueprint_bindings.target_surface IS
  'v1: screenplay only. Future: scene_blueprint, storyboard, trailer_moment.';
