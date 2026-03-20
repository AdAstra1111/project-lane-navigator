-- Migration: lookbook_rebuild_runs
-- Purpose: Audit table for lookbook visual canon rebuild executions.
-- Stores canonical execution metadata from executeCanonRebuild().
-- Separate from regeneration_runs (which tracks scene-level selective regeneration).

CREATE TABLE IF NOT EXISTS public.lookbook_rebuild_runs (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                  uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  
  -- Execution identity
  trigger_source              text        NOT NULL DEFAULT 'manual_ui',
  rebuild_mode                text        NOT NULL,
  
  -- Execution lifecycle
  execution_status            text        NOT NULL DEFAULT 'pending'
    CHECK (execution_status IN ('pending','running','completed','completed_with_unresolved','no_op','failed')),
  
  -- Scope
  targeted_slot_keys          text[]      NOT NULL DEFAULT '{}',
  
  -- Timing
  started_at                  timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  duration_ms                 integer,
  
  -- Failure diagnostics
  failure_stage               text,
  failure_message             text,
  
  -- Canonical rebuild result summary
  total_slots                 integer     NOT NULL DEFAULT 0,
  resolved_slots              integer     NOT NULL DEFAULT 0,
  unresolved_slots            integer     NOT NULL DEFAULT 0,
  generated_count             integer     NOT NULL DEFAULT 0,
  compliant_count             integer     NOT NULL DEFAULT 0,
  rejected_non_compliant_count integer    NOT NULL DEFAULT 0,
  attached_winner_count       integer     NOT NULL DEFAULT 0,
  preserved_primary_count     integer     NOT NULL DEFAULT 0,
  replaced_primary_count      integer     NOT NULL DEFAULT 0,
  winner_ids                  text[]      NOT NULL DEFAULT '{}',
  unresolved_reasons          jsonb       NOT NULL DEFAULT '[]'
);

-- Indexes
CREATE INDEX idx_lookbook_rebuild_runs_project
  ON public.lookbook_rebuild_runs(project_id, started_at DESC);

-- RLS
ALTER TABLE public.lookbook_rebuild_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lrr_select"
  ON public.lookbook_rebuild_runs
  FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "lrr_insert"
  ON public.lookbook_rebuild_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "lrr_update"
  ON public.lookbook_rebuild_runs
  FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));