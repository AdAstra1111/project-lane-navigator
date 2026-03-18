
CREATE OR REPLACE FUNCTION public.safe_delete_version(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_doc_id uuid;
  v_project_id uuid;
  v_doc_latest uuid;
  v_is_current boolean;
  v_fallback_id uuid;
  v_version_number integer;
BEGIN
  SELECT document_id, is_current, version_number
  INTO v_doc_id, v_is_current, v_version_number
  FROM public.project_document_versions
  WHERE id = p_version_id;

  IF v_doc_id IS NULL THEN
    RAISE EXCEPTION 'Version % not found', p_version_id;
  END IF;

  SELECT latest_version_id, project_id
  INTO v_doc_latest, v_project_id
  FROM public.project_documents
  WHERE id = v_doc_id;

  IF (SELECT COUNT(*) FROM public.project_document_versions WHERE document_id = v_doc_id) <= 1 THEN
    RAISE EXCEPTION 'Cannot delete the only version of a document';
  END IF;

  SELECT id INTO v_fallback_id
  FROM public.project_document_versions
  WHERE document_id = v_doc_id
    AND id != p_version_id
    AND plaintext IS NOT NULL
    AND LENGTH(BTRIM(COALESCE(plaintext, ''))) > 10
  ORDER BY version_number DESC
  LIMIT 1;

  IF v_fallback_id IS NULL THEN
    SELECT id INTO v_fallback_id
    FROM public.project_document_versions
    WHERE document_id = v_doc_id
      AND id != p_version_id
    ORDER BY version_number DESC
    LIMIT 1;
  END IF;

  IF v_doc_latest = p_version_id AND v_fallback_id IS NOT NULL THEN
    UPDATE public.project_documents
    SET latest_version_id = v_fallback_id
    WHERE id = v_doc_id;
  END IF;

  IF v_is_current AND v_fallback_id IS NOT NULL THEN
    UPDATE public.project_document_versions
    SET is_current = false WHERE id = p_version_id;
    UPDATE public.project_document_versions
    SET is_current = true WHERE id = v_fallback_id;
  END IF;

  DELETE FROM public.project_document_chunks
  WHERE version_id = p_version_id;

  DELETE FROM public.project_document_versions
  WHERE id = p_version_id;

  RETURN jsonb_build_object(
    'deleted_version_id', p_version_id,
    'fallback_version_id', v_fallback_id,
    'was_latest', v_doc_latest = p_version_id,
    'was_current', v_is_current
  );
END;
$$;
