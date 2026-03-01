
-- Add blocker-aware convergence fields to auto_run_jobs
ALTER TABLE public.auto_run_jobs
  ADD COLUMN IF NOT EXISTS best_blocker_count integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS best_blocker_score numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS stagnation_no_blocker_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_blocker_count integer DEFAULT NULL;
