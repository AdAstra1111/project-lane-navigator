-- ============================================================
-- Narrative Obligation Registry (NC1)
-- Migration: 20260312030000_narrative_obligations_v1.sql
--
-- Additive only. No existing tables modified.
-- Introduces narrative_obligations table as the canonical
-- obligation registry for the NC1/NC2 system.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.narrative_obligations (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  obligation_id    TEXT        NOT NULL,
  -- Stable deterministic key: "nc1::{obligation_type}"
  -- UNIQUE per project ensures idempotent builds.

  obligation_type  TEXT        NOT NULL CHECK (obligation_type IN (
    'promise_of_premise',
    'protagonist_arc_resolution',
    'antagonist_arc_resolution',
    'relationship_arc_bridge',
    'mystery_payoff',
    'theme_confirmation',
    'tonal_contract',
    'genre_contract',
    'climax_payoff',
    'ending_condition_fulfillment'
  )),

  source_layer     TEXT        NOT NULL,
  -- Which dev_seed_v2 layer anchors this obligation:
  -- "premise" | "axes" | "units" | "beats" | "entities"
  -- "relations" | "generation_intent" | "project_canon"

  source_key       TEXT        NOT NULL,
  -- Field or key within the layer (e.g. "premise", "climax_promise", "theme_vector")

  description      TEXT,
  -- Human-readable description of what this obligation requires

  required_by      TEXT,
  -- Which narrative guarantee this obligation supports

  severity_default TEXT        NOT NULL DEFAULT 'warning'
                   CHECK (severity_default IN ('info','warning','high','critical')),
  -- Default severity when this obligation is violated or unresolved

  provenance       JSONB       NOT NULL DEFAULT '{}',
  -- { seed_id: uuid, seed_type: "authored"|"derived", built_at: iso }

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(project_id, obligation_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS narrative_obligations_project_id_idx
  ON public.narrative_obligations(project_id);

CREATE INDEX IF NOT EXISTS narrative_obligations_type_idx
  ON public.narrative_obligations(project_id, obligation_type);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.narrative_obligations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "narrative_obligations_select"
  ON public.narrative_obligations FOR SELECT TO authenticated
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "narrative_obligations_insert"
  ON public.narrative_obligations FOR INSERT TO authenticated
  WITH CHECK (has_project_access(auth.uid(), project_id));

CREATE POLICY "narrative_obligations_update"
  ON public.narrative_obligations FOR UPDATE TO authenticated
  USING (has_project_access(auth.uid(), project_id));

CREATE POLICY "narrative_obligations_delete"
  ON public.narrative_obligations FOR DELETE TO authenticated
  USING (has_project_access(auth.uid(), project_id));
