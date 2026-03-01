-- Idempotent trigger attachment for project_document_versions + project_documents
-- Ensures triggers are attached even if functions already exist

-- 1) Attach stamp_version_measured_metrics trigger
DROP TRIGGER IF EXISTS trg_stamp_version_metrics ON public.project_document_versions;
CREATE TRIGGER trg_stamp_version_metrics
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_version_measured_metrics();

-- 2) Attach ensure_first_version_is_current trigger
DROP TRIGGER IF EXISTS trg_ensure_first_version_current ON public.project_document_versions;
CREATE TRIGGER trg_ensure_first_version_current
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_first_version_is_current();

-- 3) Attach ensure_project_document_initial_version trigger
DROP TRIGGER IF EXISTS trg_project_document_initial_version ON public.project_documents;
CREATE TRIGGER trg_project_document_initial_version
  AFTER INSERT ON public.project_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_project_document_initial_version();

-- 4) Backfill measured_metrics_json for existing versions missing it
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
-- SELECT tgname, tgenabled, c.relname
-- FROM pg_trigger t
-- JOIN pg_class c ON t.tgrelid = c.oid
-- WHERE c.relname IN ('project_document_versions', 'project_documents')
-- AND NOT t.tgisinternal
-- ORDER BY c.relname, tgname;