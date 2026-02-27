
-- Add claim fields to regen_job_items
ALTER TABLE public.regen_job_items
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS claimed_by text NULL;

-- Index for efficient claim queries
CREATE INDEX IF NOT EXISTS idx_regen_job_items_claim
  ON public.regen_job_items (job_id, status, claimed_at);

-- Atomic claim RPC: claims N queued items in one UPDATE...RETURNING
CREATE OR REPLACE FUNCTION public.claim_regen_items(
  p_job_id uuid,
  p_limit int,
  p_claimed_by text
)
RETURNS SETOF public.regen_job_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.regen_job_items
  SET status = 'running',
      claimed_at = now(),
      claimed_by = p_claimed_by,
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM public.regen_job_items
    WHERE job_id = p_job_id
      AND status = 'queued'
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
