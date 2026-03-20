
-- Round progressions: canonical next-task advancement decisions
CREATE TABLE public.round_progressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES public.competition_rounds(id) ON DELETE CASCADE,
  source_promotion_id uuid REFERENCES public.round_promotions(id),
  promoted_candidate_version_id uuid REFERENCES public.candidate_versions(id),
  progression_status text NOT NULL DEFAULT 'blocked',
  next_task_type text NOT NULL DEFAULT 'none',
  next_task_ref_id text,
  rationale text,
  progression_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

-- IEL: exactly one progression decision per round
CREATE UNIQUE INDEX idx_round_progressions_unique_round ON public.round_progressions(round_id);

-- IEL: validate progression invariants via trigger
CREATE OR REPLACE FUNCTION public.validate_round_progression()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  -- advanced must have a promoted candidate
  IF NEW.progression_status = 'advanced' AND NEW.promoted_candidate_version_id IS NULL THEN
    RAISE EXCEPTION 'advanced progression must carry a promoted_candidate_version_id';
  END IF;
  -- advanced must have a next_task reference
  IF NEW.progression_status = 'advanced' AND (NEW.next_task_ref_id IS NULL OR NEW.next_task_ref_id = '') THEN
    RAISE EXCEPTION 'advanced progression must carry a next_task_ref_id';
  END IF;
  -- blocked must NOT have a promoted candidate
  IF NEW.progression_status = 'blocked' AND NEW.promoted_candidate_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'blocked progression must not carry a promoted_candidate_version_id';
  END IF;
  -- already_advanced is read-only echo, same rules as advanced
  IF NEW.progression_status = 'already_advanced' AND NEW.promoted_candidate_version_id IS NULL THEN
    RAISE EXCEPTION 'already_advanced progression must carry a promoted_candidate_version_id';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_round_progression
  BEFORE INSERT OR UPDATE ON public.round_progressions
  FOR EACH ROW EXECUTE FUNCTION public.validate_round_progression();

-- RLS
ALTER TABLE public.round_progressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own project progressions"
  ON public.round_progressions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      JOIN public.projects p ON p.id = cg.project_id
      WHERE cg.id = round_progressions.group_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own project progressions"
  ON public.round_progressions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      JOIN public.projects p ON p.id = cg.project_id
      WHERE cg.id = round_progressions.group_id
      AND p.user_id = auth.uid()
    )
  );
