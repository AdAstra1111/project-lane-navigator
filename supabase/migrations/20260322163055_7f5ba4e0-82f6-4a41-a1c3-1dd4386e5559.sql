-- Fix dedup index to include character_key
-- Old index was (project_id, output_id, reason) which is too coarse
-- and would collapse valid multi-character jobs for the same output

DROP INDEX IF EXISTS public.idx_cast_regen_jobs_active_dedup;

CREATE UNIQUE INDEX idx_cast_regen_jobs_active_dedup
  ON public.cast_regen_jobs (project_id, character_key, output_id, reason)
  WHERE status IN ('queued', 'running');