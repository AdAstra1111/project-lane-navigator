
-- Fix Topline Narrative doc_type and content heading for existing docs

-- Part 1: Repair project_documents that are actually topline but misclassified
UPDATE public.project_documents pd
SET
  doc_type = 'topline_narrative',
  title = 'Topline Narrative'
WHERE
  pd.doc_type IN ('document', 'other', 'synopsis', 'topline')
  AND (
    pd.title ILIKE '%topline%' OR pd.title ILIKE '%logline%' OR pd.title ILIKE '%synopsis%'
    OR pd.file_name ILIKE '%topline%' OR pd.file_name ILIKE '%logline%' OR pd.file_name ILIKE '%synopsis%'
  );

-- Part 1b: Also repair docs whose latest version has deliverable_type='topline_narrative'
UPDATE public.project_documents pd
SET
  doc_type = 'topline_narrative',
  title = 'Topline Narrative'
WHERE
  pd.doc_type IN ('document', 'other', 'synopsis', 'topline')
  AND pd.latest_version_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.project_document_versions pdv
    WHERE pdv.id = pd.latest_version_id AND pdv.deliverable_type = 'topline_narrative'
  );

-- Part 2: Ensure deliverable_type is set on versions for confirmed topline docs
UPDATE public.project_document_versions pdv
SET deliverable_type = 'topline_narrative'
WHERE pdv.id IN (
  SELECT latest_version_id
  FROM public.project_documents
  WHERE doc_type = 'topline_narrative' AND latest_version_id IS NOT NULL
)
AND (pdv.deliverable_type IS NULL OR pdv.deliverable_type IS DISTINCT FROM 'topline_narrative');

-- Part 3: Replace "# Document" heading with "# Topline Narrative" in topline version content
UPDATE public.project_document_versions pdv
SET plaintext = '# Topline Narrative' || substring(pdv.plaintext from length('# Document') + 1)
WHERE pdv.deliverable_type = 'topline_narrative'
  AND pdv.plaintext LIKE '# Document%';

-- Also fix versions linked via topline project_documents
UPDATE public.project_document_versions pdv
SET plaintext = '# Topline Narrative' || substring(pdv.plaintext from length('# Document') + 1)
WHERE pdv.document_id IN (
  SELECT id FROM public.project_documents WHERE doc_type = 'topline_narrative'
)
AND pdv.plaintext LIKE '# Document%';
