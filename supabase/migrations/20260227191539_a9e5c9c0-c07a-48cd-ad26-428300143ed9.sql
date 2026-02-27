
-- Allow 'preview' status for dry-run items
ALTER TABLE public.regen_job_items DROP CONSTRAINT IF EXISTS regen_job_items_status_check;
ALTER TABLE public.regen_job_items ADD CONSTRAINT regen_job_items_status_check
  CHECK (status IN ('queued','running','regenerated','skipped','error','preview'));
