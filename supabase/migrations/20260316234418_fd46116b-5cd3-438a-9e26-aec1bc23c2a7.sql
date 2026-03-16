ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS source_dna_profile_id UUID REFERENCES public.narrative_dna_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_engine_key TEXT REFERENCES public.narrative_engines(engine_key) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_projects_source_dna_profile_id ON public.projects(source_dna_profile_id) WHERE source_dna_profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_source_engine_key ON public.projects(source_engine_key) WHERE source_engine_key IS NOT NULL;