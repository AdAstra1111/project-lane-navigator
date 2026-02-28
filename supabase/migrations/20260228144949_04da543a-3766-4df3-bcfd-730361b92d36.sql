
CREATE OR REPLACE FUNCTION public.increment_step_count(p_job_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_count integer;
  v_caller uuid;
BEGIN
  v_caller := auth.uid();
  
  UPDATE public.auto_run_jobs
  SET step_count = COALESCE(step_count, 0) + 1
  WHERE id = p_job_id
    AND (v_caller IS NULL OR user_id = v_caller)
  RETURNING step_count INTO v_new_count;
  
  IF v_new_count IS NULL THEN
    RAISE EXCEPTION 'Job not found or not owned by caller';
  END IF;
  
  RETURN v_new_count;
END;
$function$;
