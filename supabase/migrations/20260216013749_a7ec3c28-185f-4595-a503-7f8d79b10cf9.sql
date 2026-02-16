
-- Add provenance + staleness columns to project_document_versions
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS inputs_used jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_stale boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS stale_reason text,
  ADD COLUMN IF NOT EXISTS generator_id text,
  ADD COLUMN IF NOT EXISTS generator_run_id uuid;

-- Backfill: mark existing versions without depends_on_resolver_hash as stale
UPDATE public.project_document_versions
SET is_stale = true, stale_reason = 'backfill: missing depends_on_resolver_hash'
WHERE depends_on_resolver_hash IS NULL
  AND status = 'final';
