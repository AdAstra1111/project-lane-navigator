ALTER TABLE public.narrative_units
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS stale_reason jsonb;