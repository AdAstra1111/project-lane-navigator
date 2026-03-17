
-- Add learning pool fields to pitch_ideas
ALTER TABLE public.pitch_ideas
  ADD COLUMN IF NOT EXISTS learning_pool_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS learning_pool_eligibility_reason text NULL,
  ADD COLUMN IF NOT EXISTS learning_pool_qualified_at timestamptz NULL;

-- Indexes for learning pool queries
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_learning_pool ON public.pitch_ideas (learning_pool_eligible) WHERE learning_pool_eligible = true;
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_score_total ON public.pitch_ideas (score_total DESC);
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_production_type ON public.pitch_ideas (production_type);
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_recommended_lane ON public.pitch_ideas (recommended_lane);
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_source_dna_profile ON public.pitch_ideas (source_dna_profile_id) WHERE source_dna_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_source_blueprint ON public.pitch_ideas (source_blueprint_id) WHERE source_blueprint_id IS NOT NULL;

-- Backfill existing pitch ideas: set learning_pool_eligible for existing high-CI ideas
UPDATE public.pitch_ideas
SET learning_pool_eligible = true,
    learning_pool_eligibility_reason = 'ci_95_threshold_met',
    learning_pool_qualified_at = created_at
WHERE score_total >= 95 AND learning_pool_eligible = false;

-- Set reason for non-eligible
UPDATE public.pitch_ideas
SET learning_pool_eligibility_reason = 'ci_below_threshold'
WHERE score_total < 95 AND learning_pool_eligibility_reason IS NULL;

-- Add learning_pool fields to blueprint runs for telemetry
ALTER TABLE public.idea_blueprint_runs
  ADD COLUMN IF NOT EXISTS learning_pool_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS learning_pool_match_count integer NULL;
