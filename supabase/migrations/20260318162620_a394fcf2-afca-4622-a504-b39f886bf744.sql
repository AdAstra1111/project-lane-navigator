
-- Backfill vertical_episode_beats which was missed in the first backfill
UPDATE project_document_versions pv
SET 
  change_summary = REGEXP_REPLACE(
    change_summary, 
    '^Chunked rewrite across (\d+) iterations?\.$',
    'Episode-scoped rewrite across \1 passes.'
  ),
  generator_id = CASE 
    WHEN generator_id = 'dev-engine-v2-rewrite-chunked' THEN 'dev-engine-v2-rewrite-episodic'
    ELSE generator_id
  END
WHERE (change_summary LIKE 'Chunked rewrite across%' OR generator_id = 'dev-engine-v2-rewrite-chunked')
  AND EXISTS (
    SELECT 1 FROM project_documents pd
    WHERE pd.id = pv.document_id
    AND pd.doc_type IN ('vertical_episode_beats')
  );
