
-- ═══════════════════════════════════════════════════════════════════════════════
-- INGESTION HARDENING PHASE 2 — Schema upgrades
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Add source resolution & parse quality & diff to story_ingestion_runs ──
ALTER TABLE public.story_ingestion_runs
  ADD COLUMN IF NOT EXISTS source_resolution_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS parse_quality_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diff_json jsonb;

-- ── 2. Add review fields to scene_entity_participation ──
ALTER TABLE public.scene_entity_participation
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected','escalated')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- ── 3. Add review fields to state_transition_candidates ──
ALTER TABLE public.state_transition_candidates
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','approved','rejected','merged','escalated')),
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- ── 4. Add review fields to entity_aliases ──
-- review_status already exists but upgrade the constraint to support more states
ALTER TABLE public.entity_aliases DROP CONSTRAINT IF EXISTS entity_aliases_review_status_check;
ALTER TABLE public.entity_aliases ADD CONSTRAINT entity_aliases_review_status_check
  CHECK (review_status IN ('auto_accepted','review_required','rejected','confirmed','merged','escalated'));
ALTER TABLE public.entity_aliases
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- ── 5. Add provenance/status to entity_visual_states for state distribution gating ──
ALTER TABLE public.entity_visual_states
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'proposed'
    CHECK (review_status IN ('proposed','approved','rejected')),
  ADD COLUMN IF NOT EXISTS ingestion_run_id uuid REFERENCES public.story_ingestion_runs(id) ON DELETE SET NULL;

-- ── 6. Insert policies for scene_entity_participation so service writes work ──
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scene_entity_participation' AND policyname = 'sep_insert'
  ) THEN
    CREATE POLICY "sep_insert" ON public.scene_entity_participation FOR INSERT TO authenticated
      WITH CHECK (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scene_entity_participation' AND policyname = 'sep_update'
  ) THEN
    CREATE POLICY "sep_update" ON public.scene_entity_participation FOR UPDATE TO authenticated
      USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

-- ── 7. Insert/update policies for state_transition_candidates ──
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'state_transition_candidates' AND policyname = 'stc_insert'
  ) THEN
    CREATE POLICY "stc_insert" ON public.state_transition_candidates FOR INSERT TO authenticated
      WITH CHECK (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'state_transition_candidates' AND policyname = 'stc_update'
  ) THEN
    CREATE POLICY "stc_update" ON public.state_transition_candidates FOR UPDATE TO authenticated
      USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

-- ── 8. Insert/update policies for entity_aliases ──
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_aliases' AND policyname = 'ea_insert'
  ) THEN
    CREATE POLICY "ea_insert" ON public.entity_aliases FOR INSERT TO authenticated
      WITH CHECK (has_project_access(auth.uid(), project_id));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'entity_aliases' AND policyname = 'ea_update'
  ) THEN
    CREATE POLICY "ea_update" ON public.entity_aliases FOR UPDATE TO authenticated
      USING (has_project_access(auth.uid(), project_id));
  END IF;
END $$;
