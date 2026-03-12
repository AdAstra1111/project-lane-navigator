-- RP1: Narrative Repair Planner — narrative_repairs table
--
-- Stores structured repair plans derived from get_narrative_diagnostics output.
-- Plans are planning-only: no repair execution occurs from this table.
-- Idempotent: UNIQUE(project_id, source_diagnostic_id) prevents duplicate plans.
--
-- Populated by: plan_narrative_repairs action in dev-engine-v2
-- Consumed by:  RP2+ (repair execution, future installment)
--
-- Architecture-strict: additive schema, RLS enabled, fail-closed.

CREATE TABLE IF NOT EXISTS public.narrative_repairs (
  repair_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_diagnostic_id  TEXT        NOT NULL,
  repair_type           TEXT        NOT NULL,
  scope_type            TEXT        NOT NULL DEFAULT 'project',
  scope_key             TEXT,
  strategy              TEXT,
  priority_score        INTEGER     NOT NULL DEFAULT 0,
  repairability         TEXT        NOT NULL DEFAULT 'manual'
                                    CHECK (repairability IN ('auto','guided','manual','unknown')),
  status                TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending','in_progress','completed','failed','skipped')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, source_diagnostic_id)
);

CREATE INDEX IF NOT EXISTS narrative_repairs_project_id_idx
  ON public.narrative_repairs(project_id);

CREATE INDEX IF NOT EXISTS narrative_repairs_status_idx
  ON public.narrative_repairs(project_id, status);

CREATE INDEX IF NOT EXISTS narrative_repairs_priority_idx
  ON public.narrative_repairs(project_id, priority_score DESC, status);

ALTER TABLE public.narrative_repairs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'narrative_repairs' AND policyname = 'narrative_repairs_select'
  ) THEN
    CREATE POLICY "narrative_repairs_select" ON public.narrative_repairs
      FOR SELECT TO authenticated
      USING (has_project_access(auth.uid(), project_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'narrative_repairs' AND policyname = 'narrative_repairs_insert'
  ) THEN
    CREATE POLICY "narrative_repairs_insert" ON public.narrative_repairs
      FOR INSERT TO authenticated
      WITH CHECK (has_project_access(auth.uid(), project_id));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'narrative_repairs' AND policyname = 'narrative_repairs_update'
  ) THEN
    CREATE POLICY "narrative_repairs_update" ON public.narrative_repairs
      FOR UPDATE TO authenticated
      USING (has_project_access(auth.uid(), project_id));
  END IF;
END;
$$;
