-- Partial unique index: at most ONE current version per document
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdv_unique_current_per_doc
  ON public.project_document_versions (document_id)
  WHERE is_current = true;

-- Supporting index for fast lookups
CREATE INDEX IF NOT EXISTS idx_pdv_doc_version_desc
  ON public.project_document_versions (document_id, version_number DESC);

-- Trigger: first version inserted for a document auto-sets is_current = true
CREATE OR REPLACE FUNCTION public.ensure_first_version_is_current()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  -- Only act if this version is not already marked current
  IF NEW.is_current IS TRUE THEN
    RETURN NEW;
  END IF;
  
  -- Check if there is already a current version for this document
  IF NOT EXISTS (
    SELECT 1 FROM public.project_document_versions
    WHERE document_id = NEW.document_id
      AND is_current = true
      AND id != NEW.id
  ) THEN
    NEW.is_current := true;
  END IF;
  
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ensure_first_version_current ON public.project_document_versions;
CREATE TRIGGER trg_ensure_first_version_current
  BEFORE INSERT ON public.project_document_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_first_version_is_current();

-- Backfill: for documents that have versions but NO current version, set the latest one as current
WITH docs_without_current AS (
  SELECT DISTINCT document_id
  FROM public.project_document_versions pdv
  WHERE NOT EXISTS (
    SELECT 1 FROM public.project_document_versions
    WHERE document_id = pdv.document_id AND is_current = true
  )
),
latest_versions AS (
  SELECT DISTINCT ON (document_id) id, document_id
  FROM public.project_document_versions
  WHERE document_id IN (SELECT document_id FROM docs_without_current)
  ORDER BY document_id, version_number DESC, created_at DESC
)
UPDATE public.project_document_versions
SET is_current = true
WHERE id IN (SELECT id FROM latest_versions);