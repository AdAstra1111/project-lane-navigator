CREATE OR REPLACE FUNCTION public.increment_step_count(p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_count integer;
BEGIN
  UPDATE public.auto_run_jobs
  SET step_count = COALESCE(step_count, 0) + 1
  WHERE id = p_job_id
  RETURNING step_count INTO v_new_count;
  
  IF v_new_count IS NULL THEN
    RAISE EXCEPTION 'Job % not found', p_job_id;
  END IF;
  
  RETURN v_new_count;
END;
$$;