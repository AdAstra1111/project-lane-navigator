ALTER TABLE public.actor_validation_results
  ADD COLUMN IF NOT EXISTS promotable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS failure_reasons text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scoring_model text DEFAULT 'unknown';