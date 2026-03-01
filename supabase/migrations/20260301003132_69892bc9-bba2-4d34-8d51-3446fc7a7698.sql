-- Backfill: set converge_target_json to {100,100} for NULL or legacy {90,90} values
UPDATE public.auto_run_jobs
SET converge_target_json = '{"ci":100,"gp":100}'::jsonb
WHERE converge_target_json IS NULL
   OR converge_target_json = '{"ci":90,"gp":90}'::jsonb;