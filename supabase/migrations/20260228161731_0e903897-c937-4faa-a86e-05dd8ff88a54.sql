
-- Add failed_validation and needs_regen to allowed chunk statuses
CREATE OR REPLACE FUNCTION public.validate_chunk_status()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $func$
BEGIN
  IF NEW.status NOT IN ('pending', 'running', 'done', 'failed', 'failed_validation', 'needs_regen', 'skipped') THEN
    RAISE EXCEPTION 'Invalid chunk status: %', NEW.status;
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$func$;
