-- Migration: regeneration_runs_v1
-- Purpose: Create audit table for selective regeneration execution runs.
--
-- Each row records one execution of execute_selective_regeneration:
--   - what units/axes triggered it
--   - which scenes were targeted
--   - execution outcomes (completed/failed scene lists)
--   - NDG pre/post at_risk_count for validation
--   - run status lifecycle: pending → running → completed | partial_failure | failed | aborted
--
-- Stage 1 (dry-run): rows are inserted with status='pending' and meta_json.dry_run=true.
-- Stage 2 (execution): status transitions to 'running', then to a terminal state.
--
-- APPROVED KEY: regeneration_runs_v1
-- RISK LEVEL:   Additive — new table only, no changes to existing tables

CREATE TABLE IF NOT EXISTS public.regeneration_runs (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Project scope
  project_id              uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,

  -- Who triggered this run (null for service-role / automated invocations)
  triggered_by            uuid,

  -- Plan inputs — captured at run time from server-side recomputation.
  -- NEVER sourced from client input.
  source_unit_keys        text[]      NOT NULL DEFAULT '{}',
  source_axes             text[]      NOT NULL DEFAULT '{}',
  recommended_scope       text        NOT NULL,   -- no_risk | targeted_scenes | broad_impact | ...

  -- Execution targets — derived from the planner, not from client
  target_scene_ids        uuid[]      NOT NULL DEFAULT '{}',
  target_scene_count      integer     NOT NULL DEFAULT 0,

  -- Execution outcomes (populated during and after Phase 2)
  completed_scene_ids     uuid[]      NOT NULL DEFAULT '{}',
  failed_scene_ids        uuid[]      NOT NULL DEFAULT '{}',

  -- Run status lifecycle
  -- pending       → dry-run record, no generation yet
  -- running       → generation in progress
  -- completed     → all target scenes regenerated successfully
  -- partial_failure → some scenes failed, some succeeded
  -- failed        → all scenes failed (or Phase 1 failed)
  -- aborted       → scope gate fired before any writes
  status                  text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','partial_failure','failed','aborted')),

  abort_reason            text,        -- populated when status = 'aborted'

  -- NDG validation (populated in Phase 3)
  ndg_pre_at_risk_count   integer,     -- at_risk_scene_count before execution
  ndg_post_at_risk_count  integer,     -- at_risk_scene_count after execution
  ndg_validation_status   text         -- improved | unchanged | degraded | not_run
    CHECK (ndg_validation_status IS NULL OR
           ndg_validation_status IN ('improved','unchanged','degraded','not_run')),

  -- Timing
  started_at              timestamptz NOT NULL DEFAULT now(),
  completed_at            timestamptz,

  -- Flexible metadata: dry_run flag, model used, batch config, etc.
  meta_json               jsonb       NOT NULL DEFAULT '{}'
);

-- Indexes
CREATE INDEX idx_regeneration_runs_project_id
  ON public.regeneration_runs(project_id);

CREATE INDEX idx_regeneration_runs_active
  ON public.regeneration_runs(project_id, status)
  WHERE status IN ('pending', 'running');  -- partial index for concurrency guard

-- RLS
ALTER TABLE public.regeneration_runs ENABLE ROW LEVEL SECURITY;

-- Project members can read all runs for their projects
CREATE POLICY "rr_select"
  ON public.regeneration_runs
  FOR SELECT TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));

-- Authenticated users can create runs for projects they belong to
CREATE POLICY "rr_insert"
  ON public.regeneration_runs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_access(auth.uid(), project_id));

-- Only update runs that belong to the project (service role handles status transitions)
CREATE POLICY "rr_update"
  ON public.regeneration_runs
  FOR UPDATE TO authenticated
  USING (public.has_project_access(auth.uid(), project_id));
