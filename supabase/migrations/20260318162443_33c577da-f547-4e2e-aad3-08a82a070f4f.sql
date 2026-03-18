
-- Backfill stale "Chunked rewrite" metadata on episodic doc versions
-- Only updates versions where the parent document is an episodic type
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
WHERE change_summary LIKE 'Chunked rewrite across%'
  AND EXISTS (
    SELECT 1 FROM project_documents pd
    WHERE pd.id = pv.document_id
    AND pd.doc_type IN ('season_script', 'season_master_script', 'episode_script', 'episode_grid', 'episode_beats')
  );

-- Also fix the "Generated via chunked large-risk pipeline" summary
UPDATE project_document_versions pv
SET change_summary = 'Generated via episodic pipeline'
WHERE change_summary = 'Generated via chunked large-risk pipeline'
  AND EXISTS (
    SELECT 1 FROM project_documents pd
    WHERE pd.id = pv.document_id
    AND pd.doc_type IN ('season_script', 'season_master_script', 'episode_script', 'episode_grid', 'episode_beats')
  );
