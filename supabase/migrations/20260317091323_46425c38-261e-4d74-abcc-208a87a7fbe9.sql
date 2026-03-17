
-- Add design fields to idea_blueprints
ALTER TABLE public.idea_blueprints
  ADD COLUMN IF NOT EXISTS hook_type text DEFAULT '',
  ADD COLUMN IF NOT EXISTS protagonist_design jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS conflict_design jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS feasibility_design jsonb DEFAULT '{}';

-- Add evaluated_scores to candidates (independent scoring pass results)
ALTER TABLE public.idea_blueprint_candidates
  ADD COLUMN IF NOT EXISTS evaluated_scores jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS scoring_method text DEFAULT 'self_reported';
