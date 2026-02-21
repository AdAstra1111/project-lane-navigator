
-- Phase 2: Scenario Ranking columns
ALTER TABLE public.project_scenarios
  ADD COLUMN IF NOT EXISTS rank_score double precision,
  ADD COLUMN IF NOT EXISTS rank_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS ranked_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_recommended boolean NOT NULL DEFAULT false;

-- Indexes for ranking queries
CREATE INDEX IF NOT EXISTS idx_scenarios_project_rank_score
  ON public.project_scenarios (project_id, rank_score DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_scenarios_project_recommended
  ON public.project_scenarios (project_id)
  WHERE is_recommended = true;

-- Enforce only one recommended per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_scenarios_one_recommended_per_project
  ON public.project_scenarios (project_id)
  WHERE is_recommended = true;
