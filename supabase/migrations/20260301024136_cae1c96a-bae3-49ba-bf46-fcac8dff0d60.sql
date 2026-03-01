-- Backfill measured_metrics_json for current versions missing it
UPDATE public.project_document_versions
SET measured_metrics_json = jsonb_build_object(
  'measured_duration_seconds', COALESCE(ROUND(LENGTH(COALESCE(plaintext, ''))::numeric / 15.0), 0),
  'estimated_at', now()::text,
  'estimator', 'sql_backfill_char_heuristic'
)
WHERE is_current = true
  AND measured_metrics_json IS NULL
  AND plaintext IS NOT NULL
  AND LENGTH(plaintext) > 0;

-- Trigger to auto-stamp measured_metrics_json on new versions
CREATE OR REPLACE FUNCTION public.stamp_version_measured_metrics()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.measured_metrics_json IS NULL AND NEW.plaintext IS NOT NULL AND LENGTH(NEW.plaintext) > 0 THEN
    NEW.measured_metrics_json := jsonb_build_object(
      'measured_duration_seconds', ROUND(LENGTH(NEW.plaintext)::numeric / 15.0),
      'estimated_at', now()::text,
      'estimator', 'trigger_char_heuristic'
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_stamp_version_metrics ON public.project_document_versions;

CREATE TRIGGER trg_stamp_version_metrics
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_version_measured_metrics();