
-- TASK 1: Attach triggers on project_document_versions
-- Idempotent: DROP IF EXISTS then CREATE

-- A) stamp_version_measured_metrics trigger (already function exists per DB functions list)
DROP TRIGGER IF EXISTS trg_stamp_version_metrics ON public.project_document_versions;
CREATE TRIGGER trg_stamp_version_metrics
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_version_measured_metrics();

-- B) ensure_first_version_is_current trigger (function already exists)
DROP TRIGGER IF EXISTS trg_ensure_first_version_current ON public.project_document_versions;
CREATE TRIGGER trg_ensure_first_version_current
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_first_version_is_current();

-- C) ensure_project_document_initial_version trigger on project_documents (function already exists)
DROP TRIGGER IF EXISTS trg_ensure_initial_version ON public.project_documents;
CREATE TRIGGER trg_ensure_initial_version
  AFTER INSERT ON public.project_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_project_document_initial_version();

-- D) Backfill: set measured_metrics_json for rows where NULL but plaintext is present
UPDATE public.project_document_versions
SET measured_metrics_json = jsonb_build_object(
  'measured_duration_seconds', ROUND(LENGTH(plaintext)::numeric / 15.0),
  'estimated_at', now()::text,
  'estimator', 'backfill_char_heuristic'
)
WHERE measured_metrics_json IS NULL
  AND plaintext IS NOT NULL
  AND LENGTH(plaintext) > 0;

-- VERIFICATION (run manually):
-- SELECT event_object_table, trigger_name FROM information_schema.triggers
-- WHERE trigger_schema='public' AND event_object_table IN ('project_document_versions','project_documents');
