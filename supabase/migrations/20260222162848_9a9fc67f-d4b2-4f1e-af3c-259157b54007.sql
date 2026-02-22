
-- ============================================================
-- 1) rewrite_runs table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rewrite_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  source_doc_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  target_scene_numbers int[] NULL,
  summary text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rewrite_runs_project_id_idx ON public.rewrite_runs(project_id);
CREATE INDEX IF NOT EXISTS rewrite_runs_source_version_idx ON public.rewrite_runs(source_version_id);

ALTER TABLE public.rewrite_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own rewrite_runs"
  ON public.rewrite_runs FOR SELECT
  USING (public.has_project_access(auth.uid(), project_id));

CREATE POLICY "Users can insert own rewrite_runs"
  ON public.rewrite_runs FOR INSERT
  WITH CHECK (public.has_project_access(auth.uid(), project_id) AND user_id = auth.uid());

CREATE POLICY "Users can update own rewrite_runs"
  ON public.rewrite_runs FOR UPDATE
  USING (public.has_project_access(auth.uid(), project_id));

-- ============================================================
-- 2) Add run_id to rewrite_jobs and rewrite_scene_outputs
-- ============================================================
ALTER TABLE public.rewrite_jobs ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.rewrite_runs(id) ON DELETE CASCADE;
ALTER TABLE public.rewrite_scene_outputs ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES public.rewrite_runs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_rewrite_jobs_run_id ON public.rewrite_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_rewrite_scene_outputs_run_id ON public.rewrite_scene_outputs(run_id);

-- ============================================================
-- 3) Drop old unique constraint, add new one keyed by run_id
-- ============================================================
ALTER TABLE public.rewrite_scene_outputs
  DROP CONSTRAINT IF EXISTS rewrite_scene_outputs_source_version_id_scene_number_key;

ALTER TABLE public.rewrite_scene_outputs
  DROP CONSTRAINT IF EXISTS rewrite_scene_outputs_source_version_scene_unique;

CREATE UNIQUE INDEX IF NOT EXISTS rewrite_scene_outputs_run_scene_uniq
  ON public.rewrite_scene_outputs(run_id, scene_number);

-- ============================================================
-- 4) Add is_current, superseded_at, superseded_by to project_document_versions
-- ============================================================
ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;

ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz NULL;

ALTER TABLE public.project_document_versions
  ADD COLUMN IF NOT EXISTS superseded_by uuid NULL;

CREATE INDEX IF NOT EXISTS pdv_doc_current_idx
  ON public.project_document_versions(document_id, is_current);

-- ============================================================
-- 5) Updated claim_next_rewrite_job RPC to filter by run_id
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_next_rewrite_job(
  p_project_id uuid,
  p_source_version_id uuid,
  p_run_id uuid DEFAULT NULL
)
RETURNS SETOF public.rewrite_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  claimed public.rewrite_jobs;
BEGIN
  IF p_run_id IS NOT NULL THEN
    SELECT * INTO claimed
    FROM public.rewrite_jobs
    WHERE project_id = p_project_id
      AND run_id = p_run_id
      AND status = 'queued'
      AND attempts < max_attempts
    ORDER BY scene_number
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  ELSE
    SELECT * INTO claimed
    FROM public.rewrite_jobs
    WHERE project_id = p_project_id
      AND source_version_id = p_source_version_id
      AND status = 'queued'
      AND attempts < max_attempts
    ORDER BY scene_number
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
  END IF;

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
$$;

-- ============================================================
-- 6) RPC to atomically set current version
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_current_version(
  p_document_id uuid,
  p_new_version_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  prev_current_id uuid;
BEGIN
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
END;
$$;
