
CREATE TABLE public.dna_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dna_profile_id UUID REFERENCES public.narrative_dna_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID NOT NULL,
  source_url TEXT,
  source_mode TEXT NOT NULL DEFAULT 'text' CHECK (source_mode IN ('text', 'url')),
  extraction_mode TEXT NOT NULL DEFAULT 'single_pass' CHECK (extraction_mode IN ('single_pass', 'chunked')),
  normalized_text_length INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 1,
  chunk_boundaries JSONB NOT NULL DEFAULT '[]'::jsonb,
  chunk_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  synthesis_model TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('running', 'completed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.dna_extraction_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own extraction runs"
  ON public.dna_extraction_runs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service can insert extraction runs"
  ON public.dna_extraction_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());
