
-- ============================================================
-- F4: DROP + CREATE both RPCs with full definitions
-- ============================================================

-- 1) set_current_version
DROP FUNCTION IF EXISTS public.set_current_version(uuid, uuid);

CREATE OR REPLACE FUNCTION public.set_current_version(
  p_document_id uuid,
  p_new_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_old_version_id uuid;
  v_check_doc_id uuid;
BEGIN
  -- Validate new version belongs to document
  SELECT document_id INTO v_check_doc_id
  FROM project_document_versions
  WHERE id = p_new_version_id;

  IF v_check_doc_id IS NULL THEN
    RAISE EXCEPTION 'Version % not found', p_new_version_id;
  END IF;

  IF v_check_doc_id != p_document_id THEN
    RAISE EXCEPTION 'Version % does not belong to document %', p_new_version_id, p_document_id;
  END IF;

  -- Find old current version
  SELECT id INTO v_old_version_id
  FROM project_document_versions
  WHERE document_id = p_document_id AND is_current = true
  LIMIT 1;

  -- Unset old current
  IF v_old_version_id IS NOT NULL THEN
    UPDATE project_document_versions
    SET is_current = false,
        superseded_at = now(),
        superseded_by = p_new_version_id
    WHERE id = v_old_version_id;
  END IF;

  -- Set new current
  UPDATE project_document_versions
  SET is_current = true
  WHERE id = p_new_version_id;

  RETURN jsonb_build_object(
    'old_version_id', v_old_version_id,
    'new_version_id', p_new_version_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_current_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_current_version(uuid, uuid) TO service_role;

-- 2) claim_next_rewrite_job
DROP FUNCTION IF EXISTS public.claim_next_rewrite_job(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.claim_next_rewrite_job(uuid, uuid);

CREATE OR REPLACE FUNCTION public.claim_next_rewrite_job(
  p_project_id uuid,
  p_source_version_id uuid,
  p_run_id uuid
)
RETURNS SETOF rewrite_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_job rewrite_jobs%ROWTYPE;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id is required and must not be null';
  END IF;

  SELECT * INTO v_job
  FROM rewrite_jobs
  WHERE project_id = p_project_id
    AND run_id = p_run_id
    AND status = 'queued'
  ORDER BY scene_number ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_job.id IS NULL THEN
    RETURN;
  END IF;

  UPDATE rewrite_jobs
  SET status = 'running',
      claimed_at = now(),
      attempts = COALESCE(attempts, 0) + 1
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN NEXT v_job;
  RETURN;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_next_rewrite_job(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_rewrite_job(uuid, uuid, uuid) TO service_role;
