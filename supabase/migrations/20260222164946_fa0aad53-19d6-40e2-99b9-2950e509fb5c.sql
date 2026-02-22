
-- F4: Full RPC definitions with validation and grants

-- 1) set_current_version — validates new version belongs to document
DROP FUNCTION IF EXISTS public.set_current_version(uuid, uuid);

CREATE OR REPLACE FUNCTION public.set_current_version(p_document_id uuid, p_new_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  prev_current_id uuid;
  new_doc_id uuid;
BEGIN
  -- Validate new version belongs to the document
  SELECT document_id INTO new_doc_id
  FROM public.project_document_versions
  WHERE id = p_new_version_id;

  IF new_doc_id IS NULL THEN
    RAISE EXCEPTION 'Version % does not exist', p_new_version_id;
  END IF;

  IF new_doc_id != p_document_id THEN
    RAISE EXCEPTION 'Version % does not belong to document %', p_new_version_id, p_document_id;
  END IF;

  -- Find currently current version
  SELECT id INTO prev_current_id
  FROM public.project_document_versions
  WHERE document_id = p_document_id AND is_current = true
  LIMIT 1;

  -- Clear all current flags for this document
  UPDATE public.project_document_versions
  SET is_current = false
  WHERE document_id = p_document_id AND is_current = true;

  -- Mark the previous current as superseded
  IF prev_current_id IS NOT NULL THEN
    UPDATE public.project_document_versions
    SET superseded_at = now(),
        superseded_by = p_new_version_id
    WHERE id = prev_current_id;
  END IF;

  -- Set new version as current
  UPDATE public.project_document_versions
  SET is_current = true
  WHERE id = p_new_version_id;

  RETURN jsonb_build_object(
    'old_version_id', prev_current_id,
    'new_version_id', p_new_version_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_current_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_current_version(uuid, uuid) TO service_role;

-- 2) claim_next_rewrite_job — p_run_id required
DROP FUNCTION IF EXISTS public.claim_next_rewrite_job(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.claim_next_rewrite_job(
  p_project_id uuid,
  p_source_version_id uuid,
  p_run_id uuid
)
RETURNS SETOF rewrite_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  claimed public.rewrite_jobs;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required and cannot be null';
  END IF;

  SELECT * INTO claimed
  FROM public.rewrite_jobs
  WHERE project_id = p_project_id
    AND run_id = p_run_id
    AND status = 'queued'
    AND attempts < max_attempts
  ORDER BY scene_number
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF claimed.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.rewrite_jobs
  SET status = 'running',
      claimed_at = now(),
      attempts = attempts + 1
  WHERE id = claimed.id;

  SELECT * INTO claimed FROM public.rewrite_jobs WHERE id = claimed.id;
  RETURN NEXT claimed;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_next_rewrite_job(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_rewrite_job(uuid, uuid, uuid) TO service_role;
