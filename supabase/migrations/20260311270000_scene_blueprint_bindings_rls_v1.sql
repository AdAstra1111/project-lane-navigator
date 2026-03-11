-- ============================================================
-- RLS Policies — scene_blueprint_bindings
-- ============================================================
--
-- EVIDENCE (schema_drift_audit v2, 2026-03-11):
-- scene_blueprint_bindings has RLS enabled but ZERO policies.
-- Default-deny blocks all authenticated frontend reads.
--
-- The table is written exclusively by dev-engine-v2 via service role.
-- No frontend reads it directly today, but useImportPipelineStatus and
-- useScriptDropProject reference blueprint binding results (count only,
-- via edge function response), so direct frontend reads are anticipated.
--
-- Write semantics:
--   All upserts come from scene_derive_blueprint_bindings (service role).
--   Full CRUD for authenticated users is granted to allow frontend
--   reads and potential future user-override writes (patch_intent, reason).
--   Pipeline writes via service role bypass RLS — unaffected.
--
-- project_id is direct (NOT NULL, FK to projects) — canonical predicate applies.
--
-- Idempotent: policies only installed if not already present.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scene_blueprint_bindings' AND policyname='sbb_select') THEN
    CREATE POLICY "sbb_select" ON public.scene_blueprint_bindings FOR SELECT TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scene_blueprint_bindings' AND policyname='sbb_insert') THEN
    CREATE POLICY "sbb_insert" ON public.scene_blueprint_bindings FOR INSERT TO authenticated WITH CHECK (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scene_blueprint_bindings' AND policyname='sbb_update') THEN
    CREATE POLICY "sbb_update" ON public.scene_blueprint_bindings FOR UPDATE TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='scene_blueprint_bindings' AND policyname='sbb_delete') THEN
    CREATE POLICY "sbb_delete" ON public.scene_blueprint_bindings FOR DELETE TO authenticated USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
