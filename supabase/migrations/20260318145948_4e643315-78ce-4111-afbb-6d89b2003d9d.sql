-- Safe cleanup of broken/incomplete season_script versions
-- Document: 29a2ea0e-3266-48e5-9269-84fac8b43dba
-- Preserves approved v1, deletes only unapproved draft versions

-- Step 1: Fix latest_version_id FIRST (before deleting versions that may be referenced)
UPDATE public.project_documents
SET latest_version_id = (
  SELECT id FROM public.project_document_versions
  WHERE document_id = '29a2ea0e-3266-48e5-9269-84fac8b43dba'
    AND approval_status = 'approved'
  ORDER BY version_number ASC
  LIMIT 1
),
updated_at = now()
WHERE id = '29a2ea0e-3266-48e5-9269-84fac8b43dba';

-- Step 2: Clear is_current on all versions, then set it on the approved one
UPDATE public.project_document_versions
SET is_current = false
WHERE document_id = '29a2ea0e-3266-48e5-9269-84fac8b43dba';

UPDATE public.project_document_versions
SET is_current = true
WHERE document_id = '29a2ea0e-3266-48e5-9269-84fac8b43dba'
  AND approval_status = 'approved'
  AND version_number = (
    SELECT MIN(version_number) FROM public.project_document_versions
    WHERE document_id = '29a2ea0e-3266-48e5-9269-84fac8b43dba'
      AND approval_status = 'approved'
  );

-- Step 3: Delete chunks for broken draft versions
DELETE FROM public.project_document_chunks
WHERE version_id IN (
  SELECT id FROM public.project_document_versions
  WHERE document_id = '29a2ea0e-3266-48e5-9269-84fac8b43dba'
    AND approval_status IS DISTINCT FROM 'approved'
);

-- Step 4: Delete the broken draft versions
DELETE FROM public.project_document_versions
WHERE document_id = '29a2ea0e-3266-48e5-9269-84fac8b43dba'
  AND approval_status IS DISTINCT FROM 'approved';