
-- Add prev_summary and next_summary columns to rewrite_jobs
ALTER TABLE public.rewrite_jobs ADD COLUMN IF NOT EXISTS prev_summary text NULL;
ALTER TABLE public.rewrite_jobs ADD COLUMN IF NOT EXISTS next_summary text NULL;

-- Create atomic claim RPC using FOR UPDATE SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_next_rewrite_job(
  p_project_id uuid,
  p_source_version_id uuid
)
RETURNS SETOF public.rewrite_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  claimed public.rewrite_jobs;
BEGIN
  -- Atomically select + lock + update one queued job
  SELECT * INTO claimed
  FROM public.rewrite_jobs
  WHERE project_id = p_project_id
    AND source_version_id = p_source_version_id
    AND status = 'queued'
    AND attempts < max_attempts
  ORDER BY scene_number
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed.id IS NULL THEN
    RETURN; -- empty result set
  END IF;

  UPDATE public.rewrite_jobs
  SET status = 'running',
      claimed_at = now(),
      attempts = attempts + 1
  WHERE id = claimed.id;

  -- Return the updated row
  SELECT * INTO claimed FROM public.rewrite_jobs WHERE id = claimed.id;
  RETURN NEXT claimed;
END;
$$;
