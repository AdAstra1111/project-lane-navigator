UPDATE public.auto_run_jobs
SET converge_target_json = jsonb_set(converge_target_json::jsonb, '{ci}', '100')
WHERE id = '6a9b123e-1d6e-4f04-bdcd-b1bc0513b9d8'
  AND (converge_target_json::jsonb->>'ci')::int != 100;