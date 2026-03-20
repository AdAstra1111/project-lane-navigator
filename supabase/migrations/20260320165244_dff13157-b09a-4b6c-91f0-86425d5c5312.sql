
-- Repair Loop v1 Schema
-- repair_runs: tracks each repair attempt lifecycle
-- repair_targets: links repair run to source candidates with diagnostics
-- candidate_versions lineage: adds source_candidate_version_id + creation_mode

-- 1. Add lineage columns to candidate_versions
ALTER TABLE public.candidate_versions
  ADD COLUMN IF NOT EXISTS source_candidate_version_id uuid REFERENCES public.candidate_versions(id),
  ADD COLUMN IF NOT EXISTS creation_mode text NOT NULL DEFAULT 'initial';

-- 2. Create repair_runs table
CREATE TABLE public.repair_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  source_round_id uuid NOT NULL REFERENCES public.competition_rounds(id),
  repair_round_id uuid REFERENCES public.competition_rounds(id),
  repair_policy_key text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'pending',
  attempt_index int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- 3. Create repair_targets table
CREATE TABLE public.repair_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_run_id uuid NOT NULL REFERENCES public.repair_runs(id) ON DELETE CASCADE,
  source_candidate_version_id uuid NOT NULL REFERENCES public.candidate_versions(id),
  target_rank_position int,
  target_reason_key text NOT NULL DEFAULT 'low_score',
  diagnostics_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. RLS on repair_runs
ALTER TABLE public.repair_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view repair_runs for their projects"
  ON public.repair_runs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      WHERE cg.id = repair_runs.group_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

CREATE POLICY "Users can insert repair_runs for their projects"
  ON public.repair_runs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      WHERE cg.id = repair_runs.group_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

CREATE POLICY "Users can update repair_runs for their projects"
  ON public.repair_runs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      WHERE cg.id = repair_runs.group_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

-- 5. RLS on repair_targets
ALTER TABLE public.repair_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view repair_targets for their projects"
  ON public.repair_targets FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.repair_runs rr
      JOIN public.candidate_groups cg ON cg.id = rr.group_id
      WHERE rr.id = repair_targets.repair_run_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

CREATE POLICY "Users can insert repair_targets for their projects"
  ON public.repair_targets FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.repair_runs rr
      JOIN public.candidate_groups cg ON cg.id = rr.group_id
      WHERE rr.id = repair_targets.repair_run_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

-- 6. Update RoundType: change 'repair_reserved' to 'repair' in practice
-- (No enum change needed — round_type is text, we'll use 'repair' value in code)
