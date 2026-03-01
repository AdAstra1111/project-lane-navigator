-- Ensure every newly created project_document with text gets an initial current version
CREATE OR REPLACE FUNCTION public.ensure_project_document_initial_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_seed_text text;
  v_new_version_id uuid;
BEGIN
  -- If any version already exists, do nothing
  IF EXISTS (
    SELECT 1
    FROM public.project_document_versions
    WHERE document_id = NEW.id
    LIMIT 1
  ) THEN
    RETURN NEW;
  END IF;

  -- Seed only when we have source plaintext available
  v_seed_text := NULLIF(BTRIM(COALESCE(NEW.plaintext, NEW.extracted_text, '')), '');
  IF v_seed_text IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.project_document_versions (
    document_id,
    version_number,
    plaintext,
    is_current,
    status,
    label,
    created_by,
    approval_status,
    deliverable_type,
    meta_json
  ) VALUES (
    NEW.id,
    1,
    v_seed_text,
    true,
    'draft',
    'initial_baseline_seed',
    NEW.user_id,
    'draft',
    NEW.doc_type,
    jsonb_build_object('seed_source', 'project_document_insert_trigger')
  )
  RETURNING id INTO v_new_version_id;

  UPDATE public.project_documents
  SET latest_version_id = v_new_version_id
  WHERE id = NEW.id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_project_document_initial_version ON public.project_documents;
CREATE TRIGGER trg_project_document_initial_version
AFTER INSERT ON public.project_documents
FOR EACH ROW
EXECUTE FUNCTION public.ensure_project_document_initial_version();