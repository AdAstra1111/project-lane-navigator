
-- Drop old overloaded signatures of claim_next_rewrite_job
DROP FUNCTION IF EXISTS public.claim_next_rewrite_job(uuid, uuid);
DROP FUNCTION IF EXISTS public.claim_next_rewrite_job(uuid, uuid, uuid);

-- Recreate with required p_run_id (no defaults)
CREATE OR REPLACE FUNCTION public.claim_next_rewrite_job(
  p_project_id uuid,
  p_source_version_id uuid,
  p_run_id uuid
)
RETURNS SETOF rewrite_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  claimed public.rewrite_jobs;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required and cannot be null';
  END IF;

  SELECT * INTO claimed
  FROM public.rewrite_jobs
  WHERE project_id = p_project_id
    AND run_id = p_run_id
    AND status = 'queued'
    AND attempts < max_attempts
  ORDER BY scene_number
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.rewrite_jobs
  SET status = 'running',
      claimed_at = now(),
      attempts = attempts + 1
  WHERE id = claimed.id;

  SELECT * INTO claimed FROM public.rewrite_jobs WHERE id = claimed.id;
  RETURN NEXT claimed;
END;
$function$;
