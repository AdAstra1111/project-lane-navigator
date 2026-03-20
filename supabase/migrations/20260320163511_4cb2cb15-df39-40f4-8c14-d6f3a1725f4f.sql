
-- Competition Rounds table: represents one discrete competition pass within a group
CREATE TABLE public.competition_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.candidate_groups(id) ON DELETE CASCADE,
  round_index INTEGER NOT NULL DEFAULT 0,
  round_type TEXT NOT NULL DEFAULT 'initial'
    CHECK (round_type IN ('initial', 'rerun', 'manual_reassessment', 'repair_reserved')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'superseded', 'failed')),
  source_round_id UUID REFERENCES public.competition_rounds(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  UNIQUE (group_id, round_index)
);

-- Only one active round per group (enforced by partial unique index)
CREATE UNIQUE INDEX uq_competition_rounds_active_per_group
  ON public.competition_rounds (group_id)
  WHERE status = 'active';

-- Add round_id to candidate_rankings
ALTER TABLE public.candidate_rankings
  ADD COLUMN round_id UUID REFERENCES public.competition_rounds(id);

-- Add round_id to candidate_selections
ALTER TABLE public.candidate_selections
  ADD COLUMN round_id UUID REFERENCES public.competition_rounds(id);

-- RLS
ALTER TABLE public.competition_rounds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read competition rounds for their projects"
  ON public.competition_rounds FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      WHERE cg.id = competition_rounds.group_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

CREATE POLICY "Users can insert competition rounds for their projects"
  ON public.competition_rounds FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      WHERE cg.id = competition_rounds.group_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );

CREATE POLICY "Users can update competition rounds for their projects"
  ON public.competition_rounds FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.candidate_groups cg
      WHERE cg.id = competition_rounds.group_id
      AND public.has_project_access(auth.uid(), cg.project_id)
    )
  );
