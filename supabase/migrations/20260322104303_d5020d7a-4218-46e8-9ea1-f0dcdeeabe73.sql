ALTER TABLE public.ai_actors 
  ADD COLUMN IF NOT EXISTS anchor_coverage_status text NOT NULL DEFAULT 'insufficient',
  ADD COLUMN IF NOT EXISTS anchor_coherence_status text NOT NULL DEFAULT 'unknown';