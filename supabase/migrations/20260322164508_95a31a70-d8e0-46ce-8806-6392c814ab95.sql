
-- Atomic claim primitive for cast_regen_jobs (FOR UPDATE SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_next_cast_regen_job()
  RETURNS SETOF cast_regen_jobs
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.cast_regen_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.cast_regen_jobs
  WHERE status = 'queued'
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.cast_regen_jobs
  SET status = 'running',
      started_at = now()
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN NEXT v_row;
  RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_next_cast_regen_job() TO service_role;
