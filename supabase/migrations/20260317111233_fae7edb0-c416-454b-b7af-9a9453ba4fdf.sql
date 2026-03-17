
ALTER TABLE public.pitch_ideas
  ADD COLUMN IF NOT EXISTS source_blueprint_id uuid NULL,
  ADD COLUMN IF NOT EXISTS source_blueprint_run_id uuid NULL,
  ADD COLUMN IF NOT EXISTS generation_mode text NULL;

COMMENT ON COLUMN public.pitch_ideas.source_blueprint_id IS 'First-class linkage to originating idea_blueprints row';
COMMENT ON COLUMN public.pitch_ideas.source_blueprint_run_id IS 'First-class linkage to originating idea_blueprint_runs row';
COMMENT ON COLUMN public.pitch_ideas.generation_mode IS 'How this idea was generated: ci_pattern, dna_informed, etc.';
