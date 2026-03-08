-- Clear all is_current on season_arc versions for this project
UPDATE project_document_versions v
SET is_current = false
FROM project_documents d
WHERE d.id = v.document_id
  AND d.project_id = 'a2da06d6-cff2-4920-a12b-2f1deebb2b0d'
  AND d.doc_type = 'season_arc'
  AND v.is_current = true;

-- Set the approved 98/98 version as current
UPDATE project_document_versions 
SET is_current = true
WHERE id = 'dcdde789-46bc-4439-9847-1d699901f2ab';