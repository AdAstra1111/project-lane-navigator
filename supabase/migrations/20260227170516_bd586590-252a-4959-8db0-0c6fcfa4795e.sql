-- Deduplicate project_documents: keep the row with the most versions (or latest created_at).
-- For each (project_id, doc_type) with duplicates, reassign versions from losers to winner, then delete losers.

DO $$
DECLARE
  r RECORD;
  winner_id UUID;
  loser_ids UUID[];
  max_ver INT;
BEGIN
  FOR r IN
    SELECT project_id, doc_type
    FROM public.project_documents
    GROUP BY project_id, doc_type
    HAVING count(*) > 1
  LOOP
    -- Winner = row with most versions, then latest created_at
    SELECT id INTO winner_id
    FROM public.project_documents pd
    WHERE pd.project_id = r.project_id AND pd.doc_type = r.doc_type
    ORDER BY (SELECT count(*) FROM public.project_document_versions v WHERE v.document_id = pd.id) DESC,
             pd.created_at DESC
    LIMIT 1;

    -- Losers = all others
    SELECT array_agg(id) INTO loser_ids
    FROM public.project_documents
    WHERE project_id = r.project_id AND doc_type = r.doc_type AND id != winner_id;

    -- Get current max version_number on winner
    SELECT COALESCE(max(version_number), 0) INTO max_ver
    FROM public.project_document_versions WHERE document_id = winner_id;

    -- Reassign versions from losers to winner with renumbered version_numbers
    -- First clear is_current on moved versions to avoid partial unique index conflict
    UPDATE public.project_document_versions
    SET is_current = false
    WHERE document_id = ANY(loser_ids) AND is_current = true;

    -- Renumber and reassign each loser's versions
    FOR i IN 1..array_length(loser_ids, 1) LOOP
      UPDATE public.project_document_versions
      SET document_id = winner_id,
          version_number = max_ver + row_number
      FROM (
        SELECT id AS vid, row_number() OVER (ORDER BY version_number ASC) AS row_number
        FROM public.project_document_versions
        WHERE document_id = loser_ids[i]
      ) sub
      WHERE public.project_document_versions.id = sub.vid;

      -- Update max_ver
      SELECT COALESCE(max(version_number), max_ver) INTO max_ver
      FROM public.project_document_versions WHERE document_id = winner_id;
    END LOOP;

    -- Delete orphaned doc rows (no versions should remain)
    DELETE FROM public.project_documents WHERE id = ANY(loser_ids);

    RAISE NOTICE 'Deduped %.% — winner=%, losers=%', r.project_id, r.doc_type, winner_id, loser_ids;
  END LOOP;
END $$;

-- Now add UNIQUE constraint to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_documents_project_doc_type
ON public.project_documents (project_id, doc_type);
