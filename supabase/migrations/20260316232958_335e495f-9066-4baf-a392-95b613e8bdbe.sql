
-- Add DNA/engine provenance columns to pitch_ideas
ALTER TABLE public.pitch_ideas
  ADD COLUMN IF NOT EXISTS source_dna_profile_id UUID REFERENCES public.narrative_dna_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_engine_key TEXT REFERENCES public.narrative_engines(engine_key) ON DELETE SET NULL;

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_source_dna_profile_id ON public.pitch_ideas(source_dna_profile_id) WHERE source_dna_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pitch_ideas_source_engine_key ON public.pitch_ideas(source_engine_key) WHERE source_engine_key IS NOT NULL;
