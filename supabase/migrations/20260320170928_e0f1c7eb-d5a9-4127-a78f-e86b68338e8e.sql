
-- Round Promotions: canonical auto-promotion decision artifacts
-- Each row represents one promotion evaluation for a specific round.
-- Supports both promoted and not_promoted outcomes.

CREATE TABLE public.round_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES public.competition_rounds(id) ON DELETE CASCADE,
  promoted_candidate_version_id UUID REFERENCES public.candidate_versions(id) ON DELETE SET NULL,
  promotion_mode TEXT NOT NULL DEFAULT 'auto' CHECK (promotion_mode IN ('auto', 'manual_override')),
  promotion_status TEXT NOT NULL DEFAULT 'not_promoted' CHECK (promotion_status IN ('promoted', 'not_promoted')),
  gating_snapshot_json JSONB NOT NULL DEFAULT '{}',
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);

-- IEL: at most one promotion decision per round
CREATE UNIQUE INDEX idx_round_promotions_one_per_round ON public.round_promotions (round_id);

-- IEL: if not_promoted, candidate must be null
-- Enforced via trigger below

ALTER TABLE public.round_promotions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view promotions for their projects"
  ON public.round_promotions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      JOIN public.projects p ON p.id = cg.project_id
      WHERE cg.id = round_promotions.group_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert promotions for their projects"
  ON public.round_promotions FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      JOIN public.projects p ON p.id = cg.project_id
      WHERE cg.id = round_promotions.group_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update promotions for their projects"
  ON public.round_promotions FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      JOIN public.projects p ON p.id = cg.project_id
      WHERE cg.id = round_promotions.group_id
      AND p.user_id = auth.uid()
    )
  );

-- Validation trigger: not_promoted must not carry a candidate id
CREATE OR REPLACE FUNCTION public.validate_round_promotion()
  RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.promotion_status = 'not_promoted' AND NEW.promoted_candidate_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_promoted decision must not carry a candidate version id';
  END IF;
  IF NEW.promotion_status = 'promoted' AND NEW.promoted_candidate_version_id IS NULL THEN
    RAISE EXCEPTION 'promoted decision must carry a candidate version id';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_round_promotion
  BEFORE INSERT OR UPDATE ON public.round_promotions
  FOR EACH ROW EXECUTE FUNCTION public.validate_round_promotion();
