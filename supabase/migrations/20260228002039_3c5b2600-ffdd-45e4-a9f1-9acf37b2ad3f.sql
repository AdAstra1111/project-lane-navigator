
-- ============================================================
-- DevSeed Jobs + Items tables for backfill pipeline
-- ============================================================

-- 1) devseed_jobs — one per backfill run
CREATE TABLE IF NOT EXISTS public.devseed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pitch_idea_id uuid NOT NULL,
  project_id uuid,
  lane text,
  mode text NOT NULL DEFAULT 'minimal' CHECK (mode IN ('minimal', 'backfill')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'failed', 'complete')),
  include_dev_pack boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  progress_json jsonb NOT NULL DEFAULT '{"total_items":0,"done_items":0,"current_step":null,"blockers":[],"last_error":null}'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) devseed_job_items — individual work items
CREATE TABLE IF NOT EXISTS public.devseed_job_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.devseed_jobs(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  doc_type text NOT NULL,
  episode_index int,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'claimed', 'running', 'complete', 'failed')),
  claimed_at timestamptz,
  claimed_by text,
  attempts int NOT NULL DEFAULT 0,
  error_code text,
  error_detail text,
  output_doc_id uuid,
  output_version_id uuid,
  gate_score numeric,
  gate_failures text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devseed_job_items_job_status ON public.devseed_job_items(job_id, status);
CREATE INDEX IF NOT EXISTS idx_devseed_jobs_project ON public.devseed_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_devseed_jobs_pitch ON public.devseed_jobs(pitch_idea_id);

-- 3) Updated_at triggers
CREATE TRIGGER set_devseed_jobs_updated_at
  BEFORE UPDATE ON public.devseed_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_devseed_job_items_updated_at
  BEFORE UPDATE ON public.devseed_job_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) RLS policies
ALTER TABLE public.devseed_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devseed_job_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own devseed jobs"
  ON public.devseed_jobs FOR SELECT
  USING (created_by = auth.uid());

CREATE POLICY "Users can insert own devseed jobs"
  ON public.devseed_jobs FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own devseed jobs"
  ON public.devseed_jobs FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY "Service role full access devseed jobs"
  ON public.devseed_jobs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users can read own devseed job items"
  ON public.devseed_job_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.devseed_jobs j WHERE j.id = job_id AND j.created_by = auth.uid()
  ));

CREATE POLICY "Service role full access devseed job items"
  ON public.devseed_job_items FOR ALL
  USING (auth.role() = 'service_role');

-- 5) Atomic claim RPC
CREATE OR REPLACE FUNCTION public.claim_next_devseed_items(
  p_job_id uuid,
  p_limit int,
  p_claimed_by text
)
RETURNS SETOF public.devseed_job_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.devseed_job_items
  SET status = 'claimed',
      claimed_at = now(),
      claimed_by = p_claimed_by,
      attempts = COALESCE(attempts, 0) + 1,
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM public.devseed_job_items
    WHERE job_id = p_job_id
      AND status = 'queued'
    ORDER BY episode_index NULLS FIRST, item_key ASC, created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.claim_next_devseed_items(uuid, int, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_devseed_items(uuid, int, text) TO service_role;
