
-- Add DNA-aware fields to idea_blueprint_runs
ALTER TABLE public.idea_blueprint_runs
  ADD COLUMN IF NOT EXISTS source_dna_profile_id uuid REFERENCES public.narrative_dna_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dna_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS optimizer_mode text NULL;

-- Add DNA-aware fields to idea_blueprints
ALTER TABLE public.idea_blueprints
  ADD COLUMN IF NOT EXISTS source_dna_profile_id uuid REFERENCES public.narrative_dna_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_engine_key text NULL,
  ADD COLUMN IF NOT EXISTS dna_constraint_mode text NULL,
  ADD COLUMN IF NOT EXISTS blueprint_mode text NOT NULL DEFAULT 'ci_pattern';
