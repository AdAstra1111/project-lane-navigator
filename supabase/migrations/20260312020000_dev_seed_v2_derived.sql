-- ============================================================
-- Dev Seed v2 — Derived Seed Support (DS2G)
--
-- Adds `derived` boolean and `derivation_source` metadata to
-- dev_seed_v2_projects, allowing authored and derived seeds to
-- coexist per project.
--
-- Constraint change:
--   Old: UNIQUE(project_id)           → one seed per project total
--   New: UNIQUE(project_id) WHERE derived = false → one AUTHORED seed per project
--        Derived seeds are unrestricted (repeatable derivation is allowed)
-- ============================================================

-- ── Add columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.dev_seed_v2_projects
  ADD COLUMN IF NOT EXISTS derived           BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS derivation_source TEXT      DEFAULT NULL;

-- ── Replace UNIQUE constraint with partial index ──────────────────────────────
-- Drop the old blanket UNIQUE(project_id) that prevented multiple seeds.
ALTER TABLE public.dev_seed_v2_projects
  DROP CONSTRAINT IF EXISTS dev_seed_v2_projects_project_id_unique;

-- Partial unique index: only one authored (non-derived) seed per project.
-- Derived seeds (derived=true) are exempt and can accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS dev_seed_v2_projects_authored_unique
  ON public.dev_seed_v2_projects (project_id)
  WHERE derived = false;
