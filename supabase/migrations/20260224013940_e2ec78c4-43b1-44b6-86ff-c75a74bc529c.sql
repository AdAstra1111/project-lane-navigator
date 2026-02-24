ALTER TABLE public.trailer_script_runs
  ADD COLUMN IF NOT EXISTS canon_context_hash TEXT,
  ADD COLUMN IF NOT EXISTS canon_context_meta_json JSONB DEFAULT '{}'::jsonb;