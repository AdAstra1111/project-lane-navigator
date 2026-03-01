
-- =====================================================
-- Fix BASELINE_MISSING: Attach triggers + backfill data
-- =====================================================

-- 1) Attach trigger: first version inserted is always is_current=true
DROP TRIGGER IF EXISTS trg_ensure_first_version_current ON public.project_document_versions;
CREATE TRIGGER trg_ensure_first_version_current
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_first_version_is_current();

-- 2) Attach trigger: auto-seed initial version when project_document created with text
DROP TRIGGER IF EXISTS trg_project_document_initial_version ON public.project_documents;
CREATE TRIGGER trg_project_document_initial_version
  AFTER INSERT ON public.project_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_project_document_initial_version();

-- 3) Backfill: For documents with versions but no is_current, promote highest version_number
WITH missing_current AS (
  SELECT DISTINCT pdv.document_id
  FROM public.project_document_versions pdv
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_document_versions c
    WHERE c.document_id = pdv.document_id AND c.is_current = true
  )
),
best_version AS (
  SELECT DISTINCT ON (mc.document_id) mc.document_id, pdv.id AS version_id
  FROM missing_current mc
  JOIN public.project_document_versions pdv ON pdv.document_id = mc.document_id
  ORDER BY mc.document_id, pdv.version_number DESC NULLS LAST, pdv.created_at DESC NULLS LAST
)
UPDATE public.project_document_versions
SET is_current = true
FROM best_version bv
WHERE public.project_document_versions.id = bv.version_id;

-- 4) Ensure partial unique index exists (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_unique_current_per_doc
  ON public.project_document_versions (document_id)
  WHERE is_current = true;
