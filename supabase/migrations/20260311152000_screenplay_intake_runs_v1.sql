-- Screenplay Intake Runs — Persistent Observability Layer v1
--
-- Provides persisted, stage-level execution status for the screenplay-import
-- pipeline initiated from the Script Drop Zone (/projects/new).
--
-- Design principles:
--   1. OBSERVABILITY ONLY — does not replace downstream truth tables.
--      scene_graph_scenes, narrative_scene_entity_links, scene_spine_links,
--      scene_blueprint_bindings etc. remain authoritative for their own data.
--   2. ADDITIVE — no existing table is modified.
--   3. DETERMINISTIC RETRY — each stage_key is unique per run; retries UPDATE
--      the existing row rather than appending, preventing ghost run records.
--   4. FAIL-CLOSED — run status is set to 'partial' if any stage fails;
--      'done' only when all non-skipped stages reach 'done'.
--   5. IDENTITY STABLE — run.id and stage.id are UUIDs assigned at creation;
--      never derived from ordering or in-memory position.
--
-- Tables:
--   screenplay_intake_runs        — top-level run record per import event
--   screenplay_intake_stage_runs  — one row per stage per run
-- ─────────────────────────────────────────────────────────────────────────────

-- ── screenplay_intake_runs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.screenplay_intake_runs (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id            uuid        NOT NULL,
  -- Source document refs — set after stage 'ingest' completes; NULL is valid
  -- if project was created before ingest resolved doc IDs.
  source_doc_id      uuid        NULL REFERENCES public.project_documents(id) ON DELETE SET NULL,
  script_version_id  uuid        NULL REFERENCES public.project_document_versions(id) ON DELETE SET NULL,
  -- Run-level status reflects the weakest stage outcome:
  --   running  → at least one stage is running or pending
  --   done     → all non-skipped stages reached 'done'
  --   partial  → run finished but ≥1 stage failed or was skipped due to upstream failure
  --   failed   → project creation failed (no project_id persisted)
  status             text        NOT NULL DEFAULT 'running'
                     CHECK (status IN ('running','done','partial','failed')),
  initiated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz NULL,
  error              text        NULL,
  -- Lightweight metadata: source, original_filename, title_guess, etc.
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_intake_runs_project
  ON public.screenplay_intake_runs (project_id, initiated_at DESC);

CREATE INDEX IF NOT EXISTS idx_intake_runs_status
  ON public.screenplay_intake_runs (project_id, status);

ALTER TABLE public.screenplay_intake_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intake_runs_select" ON public.screenplay_intake_runs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "intake_runs_insert" ON public.screenplay_intake_runs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "intake_runs_update" ON public.screenplay_intake_runs
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role bypass (used by edge functions calling on behalf of user)
CREATE POLICY "intake_runs_service" ON public.screenplay_intake_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── screenplay_intake_stage_runs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.screenplay_intake_stage_runs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid        NOT NULL
                   REFERENCES public.screenplay_intake_runs(id) ON DELETE CASCADE,
  -- Canonical stage keys matching useScriptDropProject STAGE_DEFINITIONS:
  --   upload | ingest | project_create | scene_extract | nit_dialogue
  --   role_classify | spine_sync | binding_derive
  stage_key        text        NOT NULL,
  stage_order      int         NOT NULL,           -- display ordering; 0-indexed
  status           text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','done','failed','skipped')),
  started_at       timestamptz NULL,
  completed_at     timestamptz NULL,
  error            text        NULL,
  -- Lightweight summary of what the stage produced (e.g. {scenes_extracted:25})
  -- Never contains downstream table data — observability only.
  output_summary   jsonb       NULL,
  -- Provenance: which function/action was invoked
  function_name    text        NULL,               -- e.g. 'script-intake', 'dev-engine-v2'
  action_name      text        NULL,               -- e.g. 'ingest_pdf', 'scene_graph_extract'
  -- Retry semantics (see STAGE_DEFINITIONS in useScriptDropProject.ts):
  --   true  = stage can be independently retried if it failed
  --   false = stage outcome is terminal or requires upstream re-run
  retryable        boolean     NOT NULL DEFAULT true,
  -- Each run has exactly one row per stage_key.
  -- Retries UPDATE this row (status/timestamps/error/output_summary).
  UNIQUE (run_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_intake_stage_runs_run
  ON public.screenplay_intake_stage_runs (run_id, stage_order);

CREATE INDEX IF NOT EXISTS idx_intake_stage_runs_status
  ON public.screenplay_intake_stage_runs (run_id, status);

ALTER TABLE public.screenplay_intake_stage_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intake_stage_runs_select" ON public.screenplay_intake_stage_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.screenplay_intake_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "intake_stage_runs_insert" ON public.screenplay_intake_stage_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.screenplay_intake_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "intake_stage_runs_update" ON public.screenplay_intake_stage_runs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.screenplay_intake_runs r
      WHERE r.id = run_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "intake_stage_runs_service" ON public.screenplay_intake_stage_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
