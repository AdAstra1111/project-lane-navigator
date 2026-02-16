-- Add step_resolver_hash to auto_run_steps for hash tracking
ALTER TABLE public.auto_run_steps ADD COLUMN IF NOT EXISTS step_resolver_hash text;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_auto_run_steps_resolver_hash ON public.auto_run_steps (step_resolver_hash);